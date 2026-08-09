import { ILLMProvider, GenerationRequest, GenerationResponse } from '../types.js';

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
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: unknown[];
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
    finish_reason?: string | null;
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: unknown[];
    };
    message?: {
      content?: string | null;
      tool_calls?: unknown[];
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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: request.model ?? this.model,
          messages: request.messages,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        }),
      });
    } catch (err: any) {
      throw this.providerError(
        'PROVIDER_CONNECTION_ERROR',
        `Provider connection failed to ${this.baseUrl}: ${err.message}`,
        undefined,
        err
      );
    }

    const body = await response.text();

    if (!response.ok) {
      const msg = this.extractError(body, `OpenAI-compatible provider returned HTTP ${response.status}`);
      throw this.providerError(
        'PROVIDER_REQUEST_ERROR',
        `Provider request failed at ${this.baseUrl}: ${msg}`,
        response.status
      );
    }

    const parsed = this.parseCompletionBody(body, request.model ?? this.model);
    parsed.latencyMs = Date.now() - start;
    return parsed;
  }

  private parseCompletionBody(body: string, requestedModel: string): GenerationResponse {
    const trimmed = body.trim();
    if (!trimmed) {
      throw this.providerError('PROVIDER_EMPTY_RESPONSE', `Provider ${this.name} returned an empty response body`);
    }

    // Many local OpenAI-compatible routers return a normal JSON object with an
    // erroneous event-stream content type, or append `data: [DONE]` after JSON.
    // Prefer real body shape over headers.
    if (trimmed.startsWith('{')) {
      const json = this.extractFirstJsonObject(trimmed);
      if (json) {
        return this.parseJsonCompletion(json, requestedModel);
      }
    }

    if (trimmed.startsWith('data:') || trimmed.includes('\ndata:')) {
      return this.parseEventStream(trimmed, requestedModel);
    }

    // Last chance: some servers prepend harmless whitespace/text before JSON.
    const json = this.extractFirstJsonObject(trimmed);
    if (json) {
      return this.parseJsonCompletion(json, requestedModel);
    }

    throw this.providerError(
      'PROVIDER_RESPONSE_PARSE_ERROR',
      `Failed to identify OpenAI-compatible response format from provider "${this.name}": ${body.slice(0, 200)}`
    );
  }

  private parseJsonCompletion(body: string, requestedModel: string): GenerationResponse {
    let parsed: OpenAIChatCompletion;
    try {
      parsed = JSON.parse(body) as OpenAIChatCompletion;
    } catch (err: any) {
      throw this.providerError(
        'PROVIDER_RESPONSE_PARSE_ERROR',
        `Failed to parse response JSON from provider "${this.name}": ${body.slice(0, 200)}`,
        undefined,
        err
      );
    }

    if (parsed.error?.message) {
      throw this.providerError('PROVIDER_REQUEST_ERROR', parsed.error.message);
    }

    const choice = parsed.choices?.[0];
    const content = choice?.message?.content ?? '';
    if (!content && choice?.message?.tool_calls?.length) {
      throw this.providerError(
        'PROVIDER_TOOL_CALL_RESPONSE_UNSUPPORTED',
        `Provider ${this.name} returned tool_calls with no assistant text; FuckClaw did not request provider-native tool calls for this request.`
      );
    }

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
    let sawToolCallWithoutContent = false;
    let parsedAnyChunk = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith('data:')) {
        continue;
      }

      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        if (payload === '[DONE]') break;
        continue;
      }

      let chunk: OpenAIChatCompletionChunk;
      try {
        chunk = JSON.parse(payload) as OpenAIChatCompletionChunk;
      } catch {
        // Ignore malformed keepalive chunks; valid data chunks must be JSON.
        continue;
      }
      parsedAnyChunk = true;

      if (chunk.error?.message) {
        throw this.providerError('PROVIDER_REQUEST_ERROR', chunk.error.message);
      }
      if (chunk.model) {
        responseModel = chunk.model;
      }
      if (chunk.usage) {
        explicitUsage = chunk.usage;
      }

      const choice = chunk.choices?.[0];
      const deltaContent = choice?.delta?.content ?? '';
      const messageContent = choice?.message?.content ?? '';
      if (deltaContent) content += deltaContent;
      if (messageContent) content += messageContent;
      if (!deltaContent && !messageContent && (choice?.delta?.tool_calls?.length || choice?.message?.tool_calls?.length)) {
        sawToolCallWithoutContent = true;
      }
    }

    if (!parsedAnyChunk) {
      throw this.providerError(
        'PROVIDER_RESPONSE_PARSE_ERROR',
        `Failed to parse any JSON chunks from OpenAI-compatible event-stream response from provider "${this.name}"`
      );
    }

    if (!content && sawToolCallWithoutContent) {
      throw this.providerError(
        'PROVIDER_TOOL_CALL_RESPONSE_UNSUPPORTED',
        `Provider ${this.name} returned streaming tool_calls with no assistant text; FuckClaw did not request provider-native tool calls for this request.`
      );
    }

    return {
      content,
      provider: this.name,
      model: responseModel,
      usage: this.extractUsage(explicitUsage, content),
    };
  }

  private extractFirstJsonObject(input: string): string | null {
    const start = input.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < input.length; i++) {
      const ch = input[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return input.slice(start, i + 1);
        }
      }
    }

    return null;
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
    const json = this.extractFirstJsonObject(body.trim());
    if (json) {
      try {
        const parsed = JSON.parse(json) as OpenAIErrorBody;
        return parsed.error?.message ?? defaultMessage;
      } catch {}
    }
    return body.trim() || defaultMessage;
  }

  private providerError(code: string, message: string, httpStatus?: number, cause?: unknown): Error {
    const err = new Error(message) as any;
    err.code = code;
    err.provider = this.name;
    err.model = this.model;
    err.endpoint = this.baseUrl;
    if (httpStatus !== undefined) err.httpStatus = httpStatus;
    if (cause !== undefined) err.cause = cause;
    return err;
  }
}
