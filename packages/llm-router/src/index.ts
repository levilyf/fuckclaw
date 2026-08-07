import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerationRequest {
  messages: ChatMessage[];
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  taskId?: string;
}

export interface GenerationResponse {
  content: string;
  provider: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
  latencyMs?: number;
}

export interface ILLMProvider {
  name: string;
  generate(request: GenerationRequest): Promise<GenerationResponse>;
}

export interface OpenAICompatibleProviderOptions {
  name?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof globalThis.fetch;
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenAIErrorBody {
  error?: {
    message?: string;
  };
}

interface OpenAIChatCompletion {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: OpenAIUsage;
  error?: {
    message?: string;
  };
}

interface OpenAIChatCompletionChunk {
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
  usage?: OpenAIUsage;
  error?: {
    message?: string;
  };
}

export class OpenAICompatibleProvider implements ILLMProvider {
  public readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImplementation: typeof globalThis.fetch;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.name = options.name ?? 'openai-compatible';
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const start = Date.now();
    const response = await this.fetchImplementation(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model ?? this.model,
        messages: request.messages,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
      }),
    });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(this.extractError(body, `OpenAI-compatible provider returned HTTP ${response.status}`));
    }

    const contentType = response.headers.get('content-type') ?? '';
    const parsed = (contentType.includes('text/event-stream') || body.trimStart().startsWith('data:'))
      ? this.parseEventStream(body, request.model ?? this.model)
      : this.parseJsonCompletion(body, request.model ?? this.model);

    parsed.latencyMs = Date.now() - start;
    return parsed;
  }

  private parseJsonCompletion(body: string, requestedModel: string): GenerationResponse {
    let parsed: OpenAIChatCompletion;
    try {
      parsed = JSON.parse(body) as OpenAIChatCompletion;
    } catch {
      throw new Error(`Failed to parse response JSON from provider "${this.name}": ${body.slice(0, 200)}`);
    }

    if (parsed.error?.message) {
      throw new Error(parsed.error.message);
    }

    const choice = parsed.choices?.[0];
    const content = choice?.message?.content ?? '';
    const usage = this.extractUsage(parsed.usage, content);

    return {
      content,
      provider: this.name,
      model: parsed.model ?? requestedModel,
      usage,
    };
  }

  private parseEventStream(body: string, requestedModel: string): GenerationResponse {
    const lines = body.split(/\r?\n/);
    let content = '';
    let responseModel = requestedModel;
    let explicitUsage: OpenAIUsage | undefined;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith('data:')) {
        continue;
      }

      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        break;
      }

      try {
        const chunk = JSON.parse(payload) as OpenAIChatCompletionChunk;
        if (chunk.error?.message) {
          throw new Error(chunk.error.message);
        }
        if (chunk.model) {
          responseModel = chunk.model;
        }
        if (chunk.usage) {
          explicitUsage = chunk.usage;
        }

        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          content += delta;
        }
      } catch (err: any) {
        if (err.message && !err.message.includes('Unexpected token')) {
          throw err;
        }
      }
    }

    return {
      content,
      provider: this.name,
      model: responseModel,
      usage: this.extractUsage(explicitUsage, content),
    };
  }

  private extractUsage(usage: OpenAIUsage | undefined, content: string): GenerationResponse['usage'] {
    if (usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') {
      const promptTokens = usage.prompt_tokens;
      const completionTokens = usage.completion_tokens;
      return {
        promptTokens,
        completionTokens,
        totalTokens: usage.total_tokens ?? (promptTokens + completionTokens),
      };
    }

    // Heuristic fallback: ~4 characters per token
    const estimatedOutputTokens = Math.max(1, Math.ceil(content.length / 4));
    return {
      promptTokens: 10,
      completionTokens: estimatedOutputTokens,
      totalTokens: 10 + estimatedOutputTokens,
    };
  }

  private extractError(body: string, defaultMessage: string): string {
    try {
      const parsed = JSON.parse(body) as OpenAIErrorBody;
      return parsed.error?.message ?? defaultMessage;
    } catch {
      return body.trim() || defaultMessage;
    }
  }
}

export class MockLLMProvider implements ILLMProvider {
  constructor(
    public readonly name: string = 'mock',
    private defaultContent: string = 'Mock response',
    private tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } = {
      promptTokens: 10,
      completionTokens: 10,
      totalTokens: 20,
    }
  ) {}

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    return {
      content: this.defaultContent,
      provider: this.name,
      model: request.model ?? 'mock-v1',
      usage: this.tokenUsage,
    };
  }
}

export class LLMRouter {
  private providers: Map<string, ILLMProvider> = new Map();
  private defaultProviderName?: string;

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

    const providerList = [
      this.providers.get(targetProviderName),
      ...Array.from(this.providers.values()).filter((p) => p.name !== targetProviderName),
    ].filter((p): p is ILLMProvider => !!p);

    let lastError: unknown;
    for (const provider of providerList) {
      try {
        const response = await provider.generate(request);
        const duration = Date.now() - start;

        // Estimate token cost (§12.4)
        const costUsd = this.estimateCost(response.model, response.usage.promptTokens, response.usage.completionTokens);
        response.costUsd = costUsd;

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

  private estimateCost(_model: string, promptTokens: number, completionTokens: number): number {
    // Default pricing: $3.00/M input, $15.00/M output
    const inputRate = 3.0 / 1_000_000;
    const outputRate = 15.0 / 1_000_000;
    return Number((promptTokens * inputRate + completionTokens * outputRate).toFixed(6));
  }
}
