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
      }),
    });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(this.extractError(body, `OpenAI-compatible provider returned HTTP ${response.status}`));
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream') || body.trimStart().startsWith('data:')) {
      return this.parseEventStream(body, request.model ?? this.model);
    }

    return this.parseJsonCompletion(body, request.model ?? this.model);
  }

  private parseJsonCompletion(body: string, requestedModel: string): GenerationResponse {
    let payload: OpenAIChatCompletion;
    try {
      payload = JSON.parse(body) as OpenAIChatCompletion;
    } catch {
      throw new Error('OpenAI-compatible provider returned invalid JSON');
    }

    if (payload.error?.message) {
      throw new Error(payload.error.message);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI-compatible provider returned no assistant content');
    }

    return {
      content,
      provider: this.name,
      model: payload.model ?? requestedModel,
      usage: normalizeUsage(payload.usage),
    };
  }

  private parseEventStream(body: string, requestedModel: string): GenerationResponse {
    let content = '';
    let model = requestedModel;
    let usage: OpenAIUsage | undefined;

    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let chunk: OpenAIChatCompletionChunk;
      try {
        chunk = JSON.parse(data) as OpenAIChatCompletionChunk;
      } catch {
        throw new Error('OpenAI-compatible provider returned an invalid SSE chunk');
      }

      if (chunk.error?.message) {
        throw new Error(chunk.error.message);
      }
      model = chunk.model ?? model;
      content += chunk.choices?.[0]?.delta?.content ?? '';
      usage = chunk.usage ?? usage;
    }

    if (!content) {
      throw new Error('OpenAI-compatible provider returned no assistant content');
    }

    return {
      content,
      provider: this.name,
      model,
      usage: normalizeUsage(usage),
    };
  }

  private extractError(body: string, fallback: string): string {
    try {
      const payload = JSON.parse(body) as OpenAIErrorBody;
      return payload.error?.message ?? fallback;
    } catch {
      return fallback;
    }
  }
}

function normalizeUsage(usage?: OpenAIUsage): GenerationResponse['usage'] {
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? ((usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0)),
  };
}

/** Test/dev provider. Production runtime never selects this implicitly. */
export class MockLLMProvider implements ILLMProvider {
  constructor(
    public name: string = 'mock',
    private defaultReply: string = 'Mock LLM Response'
  ) {}

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const promptLen = request.messages.reduce((acc, message) => acc + message.content.length, 0);
    return {
      content: this.defaultReply,
      provider: this.name,
      model: request.model || 'mock-v1',
      usage: {
        promptTokens: Math.ceil(promptLen / 4),
        completionTokens: Math.ceil(this.defaultReply.length / 4),
        totalTokens: Math.ceil((promptLen + this.defaultReply.length) / 4),
      },
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

  registerProvider(provider: ILLMProvider, isDefault: boolean = true): void {
    this.providers.set(provider.name, provider);
    if (isDefault || !this.defaultProviderName) {
      this.defaultProviderName = provider.name;
    }
    this.logger.log({ level: 'debug', message: 'LLM Provider registered', metadata: { provider: provider.name } });
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const targetName = request.provider || this.defaultProviderName;
    if (!targetName || !this.providers.has(targetName)) {
      throw new Error(`LLM Provider not found: ${targetName}`);
    }

    const provider = this.providers.get(targetName)!;
    await this.eventBus.emit('llm.generation.started', { provider: targetName });

    const start = Date.now();
    const response = await provider.generate(request);
    const duration = Date.now() - start;

    await this.eventBus.emit('llm.generation.completed', {
      provider: targetName,
      totalTokens: response.usage.totalTokens,
    });

    this.logger.log({
      level: 'info',
      message: `LLM request completed in ${duration}ms via ${targetName}`,
      metadata: { model: response.model, usage: response.usage },
    });

    return response;
  }
}
