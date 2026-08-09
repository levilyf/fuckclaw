import { ILLMProvider, GenerationRequest, GenerationResponse } from '../types.js';

export interface AnthropicProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  anthropicVersion?: string;
  timeoutMs?: number;
}

export class AnthropicProvider implements ILLMProvider {
  name = 'anthropic';
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private anthropicVersion: string;
  private timeoutMs: number;

  constructor(config: AnthropicProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
    this.baseUrl = config.baseUrl ?? 'https://api.anthropic.com/v1';
    this.defaultModel = config.defaultModel ?? 'claude-3-7-sonnet-20250219';
    this.anthropicVersion = config.anthropicVersion ?? '2023-06-01';
    this.timeoutMs = config.timeoutMs ?? 60000;
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key is required but not configured (check ANTHROPIC_API_KEY).');
    }

    const model = request.model ?? this.defaultModel;

    // Extract system message
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const systemPrompt = systemMessages.map((m) => m.content).join('\n\n');

    // Filter non-system messages
    const conversationMessages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));

    if (conversationMessages.length === 0) {
      conversationMessages.push({ role: 'user', content: 'Hello' });
    }

    const payload: Record<string, unknown> = {
      model,
      messages: conversationMessages,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
    };

    if (systemPrompt.length > 0) {
      payload.system = systemPrompt;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': this.anthropicVersion,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Anthropic API error (${res.status} ${res.statusText}): ${errorText}`);
      }

      const data: any = await res.json();
      const contentText = data.content?.[0]?.text ?? '';
      const promptTokens = data.usage?.input_tokens ?? 0;
      const completionTokens = data.usage?.output_tokens ?? 0;
      const totalTokens = promptTokens + completionTokens;

      return {
        content: contentText,
        provider: this.name,
        model,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
