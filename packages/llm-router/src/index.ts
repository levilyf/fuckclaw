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

export class MockLLMProvider implements ILLMProvider {
  constructor(
    public name: string = 'mock',
    private defaultReply: string = 'Mock LLM Response'
  ) {}

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const promptLen = request.messages.reduce((acc, m) => acc + m.content.length, 0);
    return {
      content: this.defaultReply,
      provider: this.name,
      model: request.model || 'mock-v1',
      usage: {
        promptTokens: Math.ceil(promptLen / 4),
        completionTokens: Math.ceil(this.defaultReply.length / 4),
        totalTokens: Math.ceil((promptLen + this.defaultReply.length) / 4)
      }
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
      totalTokens: response.usage.totalTokens
    });

    this.logger.log({
      level: 'info',
      message: `LLM request completed in ${duration}ms via ${targetName}`,
      metadata: { usage: response.usage }
    });

    return response;
  }
}
