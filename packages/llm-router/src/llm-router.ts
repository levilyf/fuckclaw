import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { ILLMProvider, GenerationRequest, GenerationResponse, ILLMRouter } from './types.js';
import { CostCalculator } from './budget/cost-calculator.js';
import { BudgetTracker } from './budget/budget-tracker.js';
import { ResponseCache } from './cache/response-cache.js';
import { RouteSelector } from './router/route-selector.js';

export class LLMRouter implements ILLMRouter {
  private providers: Map<string, ILLMProvider> = new Map();
  private defaultProviderName?: string;
  public readonly budget = new BudgetTracker();
  public readonly cache = new ResponseCache();

  constructor(
    private logger: IObservability,
    private eventBus: IEventBus
  ) {}

  registerProvider(provider: ILLMProvider, isDefault: boolean = false): void {
    this.providers.set(provider.name, provider);
    if (isDefault || !this.defaultProviderName) {
      this.defaultProviderName = provider.name;
    }
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const start = Date.now();
    const cacheKey = ResponseCache.generateKey(request);

    // 1. Response Cache Lookup (§12.2)
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.logger.log({
        level: 'info',
        module: 'llm-router',
        message: `Serving cached response for model ${cached.model}`,
        metadata: { model: cached.model, cached: true },
      });
      await this.eventBus.emit('llm.request.cache_hit', {
        provider: cached.provider,
        model: cached.model,
      });
      return cached;
    }

    await this.eventBus.emit('llm.request.started', {
      model: request.model,
      provider: request.provider ?? this.defaultProviderName,
      taskId: request.taskId,
    });

    const targetProviderName = request.provider ?? this.defaultProviderName;
    if (!targetProviderName) {
      throw new Error('No LLM provider registered in LLMRouter');
    }

    const providerList = RouteSelector.select(this.providers, request.provider, this.defaultProviderName);

    const causes: Array<Record<string, unknown>> = [];
    let lastError: any;
    for (const provider of providerList) {
      try {
        const response = await provider.generate(request);
        const duration = Date.now() - start;

        // Estimate token cost (§12.4)
        const costUsd = this.estimateCost(response.model, response.usage.promptTokens, response.usage.completionTokens);
        response.costUsd = costUsd;
        this.budget.record(costUsd, response.usage.totalTokens);

        await this.eventBus.emit('llm.request.completed', {
          provider: response.provider,
          model: response.model,
          usage: response.usage,
          costUsd,
          durationMs: duration,
        });

        await this.eventBus.emit('llm.cost.recorded', {
          costUsd,
          tokens: response.usage.totalTokens,
        });

        this.logger.getMetrics?.().incrementCounter('llm.requests');
        this.logger.getMetrics?.().incrementCounter('llm.prompt_tokens', response.usage.promptTokens);
        this.logger.getMetrics?.().incrementCounter('llm.completion_tokens', response.usage.completionTokens);
        this.logger.getMetrics?.().recordHistogram('llm.latency_ms', duration);

        this.logger.log({
          level: 'info',
          module: 'llm-router',
          message: `LLM request completed in ${duration}ms via ${response.provider}`,
          metadata: { model: response.model, usage: response.usage, costUsd },
        });

        // Store in Response Cache (§12.2)
        this.cache.set(cacheKey, response);

        return response;
      } catch (err: any) {
        lastError = err;
        causes.push({
          code: err?.code,
          provider: err?.provider ?? provider.name,
          model: err?.model ?? request.model,
          endpoint: err?.endpoint,
          httpStatus: err?.httpStatus,
          message: err?.message ?? String(err),
        });
        this.logger.log({
          level: 'warn',
          module: 'llm-router',
          message: `Provider "${provider.name}" failed, evaluating cascade fallback`,
          metadata: { error: err?.message ?? String(err), code: err?.code, provider: provider.name },
        });
      }
    }

    const finalError = new Error(
      `All LLM providers failed. Last error: ${lastError?.message ?? String(lastError)}`
    ) as any;
    finalError.code = lastError?.code ?? 'LLM_PROVIDER_FAILURE';
    finalError.provider = lastError?.provider;
    finalError.model = lastError?.model ?? request.model;
    finalError.endpoint = lastError?.endpoint;
    finalError.httpStatus = lastError?.httpStatus;
    finalError.causes = causes;
    finalError.cause = lastError;
    throw finalError;
  }

  public estimateCost(_model: string, promptTokens: number, completionTokens: number): number {
    return CostCalculator.calculate(promptTokens, completionTokens);
  }
}
