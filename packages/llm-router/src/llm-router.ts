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

    let lastError: unknown;
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

        return response;
      } catch (err) {
        lastError = err;
        this.logger.log({
          level: 'warn',
          module: 'llm-router',
          message: `Provider "${provider.name}" failed, evaluating cascade fallback`,
          metadata: { error: String(err) },
        });
      }
    }

    throw new Error(`All LLM providers failed. Last error: ${String(lastError)}`);
  }

  public estimateCost(_model: string, promptTokens: number, completionTokens: number): number {
    return CostCalculator.calculate(promptTokens, completionTokens);
  }
}
