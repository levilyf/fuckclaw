import { ILLMProvider, GenerationRequest, GenerationResponse } from '../types.js';

export interface GoogleProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
}

export class GoogleProvider implements ILLMProvider {
  name = 'google';
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private timeoutMs: number;

  constructor(config: GoogleProviderConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
    this.baseUrl = config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.defaultModel = config.defaultModel ?? 'gemini-1.5-pro';
    this.timeoutMs = config.timeoutMs ?? 60000;
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    if (!this.apiKey) {
      throw new Error('Google API key is required but not configured (check GEMINI_API_KEY or GOOGLE_API_KEY).');
    }

    const model = request.model ?? this.defaultModel;

    // Extract system message
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const systemPrompt = systemMessages.map((m) => m.content).join('\n\n');

    // Build contents
    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
    }

    const payload: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 4096,
      },
    };

    if (systemPrompt.length > 0) {
      payload.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/models/${model}:generateContent?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Google Gemini API error (${res.status} ${res.statusText}): ${errorText}`);
      }

      const data: any = await res.json();
      const firstCandidate = data.candidates?.[0];
      const contentText = firstCandidate?.content?.parts?.[0]?.text ?? '';
      const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
      const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
      const totalTokens = data.usageMetadata?.totalTokenCount ?? (promptTokens + completionTokens);

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
