import { describe, it, expect, vi } from 'vitest';
import {
  LLMRouter,
  MockLLMProvider,
  OpenAICompatibleProvider,
  AnthropicProvider,
  GoogleProvider,
  ResponseCache,
} from '../src/index.js';
import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';

describe('LLMRouter', () => {
  it('should route request through registered provider', async () => {
    const config = new ConfigManager();
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);

    const router = new LLMRouter(logger, bus);
    const mockProvider = new MockLLMProvider('mock', 'Mock response output');
    router.registerProvider(mockProvider);

    const response = await router.generate({
      messages: [{ role: 'user', content: 'hello' }],
      provider: 'mock'
    });

    expect(response.content).toBe('Mock response output');
    expect(response.usage.totalTokens).toBeGreaterThan(0);
  });

  it('should fallback to default provider if not specified', async () => {
    const config = new ConfigManager();
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);

    const router = new LLMRouter(logger, bus);
    const mockProvider = new MockLLMProvider('default', 'Default response');
    router.registerProvider(mockProvider);

    const response = await router.generate({
      messages: [{ role: 'user', content: 'test default' }]
    });

    expect(response.content).toBe('Default response');
  });

  it('should call an OpenAI-compatible chat completions endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 'chatcmpl-test',
      model: 'test-model',
      choices: [{ message: { role: 'assistant', content: 'Final Answer: done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const provider = new OpenAICompatibleProvider({
      name: 'local',
      baseUrl: 'http://localhost:20128/v1',
      apiKey: 'secret',
      model: 'test-model',
      fetch: fetchMock
    });

    const response = await provider.generate({
      messages: [{ role: 'user', content: 'do the task' }]
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:20128/v1/chat/completions');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret'
      }
    });
    expect(response.content).toBe('Final Answer: done');
    expect(response.usage.totalTokens).toBe(16);
  });

  it('should consume SSE chat completion chunks returned by compatible routers', async () => {
    const body = [
      'data: {"id":"1","model":"test-model","choices":[{"delta":{"role":"assistant","content":"Thought: use a tool\\n"},"finish_reason":null}]}',
      '',
      'data: {"id":"1","model":"test-model","choices":[{"delta":{"content":"Action: filesystem\\nAction Input: {\\"action\\":\\"write\\",\\"path\\":\\"workspace/test.txt\\",\\"content\\":\\"Hello\\"}"},"finish_reason":null}]}',
      '',
      'data: {"id":"1","model":"test-model","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"completion_tokens":10,"total_tokens":30}}',
      '',
      'data: [DONE]',
      ''
    ].join('\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    }));

    const provider = new OpenAICompatibleProvider({
      name: 'local',
      baseUrl: 'http://localhost:20128/v1/',
      apiKey: 'secret',
      model: 'test-model',
      fetch: fetchMock
    });

    const response = await provider.generate({
      messages: [{ role: 'user', content: 'write a file' }]
    });

    expect(response.content).toContain('Action: filesystem');
    expect(response.content).toContain('"content":"Hello"');
    expect(response.usage).toEqual({ promptTokens: 20, completionTokens: 10, totalTokens: 30 });
  });

  it('should throw a useful error for provider error responses', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'invalid model' }
    }), { status: 400, headers: { 'content-type': 'application/json' } }));
    const provider = new OpenAICompatibleProvider({
      name: 'local',
      baseUrl: 'http://localhost:20128/v1',
      apiKey: 'secret',
      model: 'bad-model',
      fetch: fetchMock
    });

    await expect(provider.generate({ messages: [{ role: 'user', content: 'hello' }] }))
      .rejects.toThrow('invalid model');
  });

  it('should cache responses and return cache hit on identical requests (§12.2)', async () => {
    const config = new ConfigManager();
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);

    let callCount = 0;
    const provider = {
      name: 'counted-mock',
      async generate() {
        callCount++;
        return {
          content: `Generated response #${callCount}`,
          provider: 'counted-mock',
          model: 'mock-model',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        };
      },
    };

    const router = new LLMRouter(logger, bus);
    router.registerProvider(provider, true);

    const req = {
      messages: [{ role: 'user' as const, content: 'deterministic prompt' }],
      temperature: 0,
    };

    // 1. First call -> Cache Miss
    const res1 = await router.generate(req);
    expect(res1.content).toBe('Generated response #1');
    expect(callCount).toBe(1);

    // 2. Second identical call -> Cache Hit
    const res2 = await router.generate(req);
    expect(res2.content).toBe('Generated response #1');
    expect(callCount).toBe(1); // Provider not called again

    db.close();
  });

  it('should construct Anthropic and Google providers with configuration (§12.3)', () => {
    const anthropic = new AnthropicProvider({
      apiKey: 'test-ant-key',
      defaultModel: 'claude-3-5-sonnet',
    });
    expect(anthropic.name).toBe('anthropic');

    const google = new GoogleProvider({
      apiKey: 'test-gemini-key',
      defaultModel: 'gemini-1.5-flash',
    });
    expect(google.name).toBe('google');
  });
});

describe('OpenAICompatibleProvider response parsing', () => {
  function makeProvider(fetchMock: any) {
    return new OpenAICompatibleProvider({
      name: 'test',
      baseUrl: 'http://localhost:20128/v1',
      apiKey: '',
      model: 'test-model',
      fetch: fetchMock,
    });
  }

  it('should parse standard JSON OpenAI completion', async () => {
    const body = JSON.stringify({
      id: 'chatcmpl-abc',
      model: 'test-model',
      choices: [{ message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    });
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const provider = makeProvider(fetchMock);
    const res = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.content).toBe('Hello');
    expect(res.usage.totalTokens).toBe(6);
  });

  it('should parse JSON body even when content-type is text/event-stream', async () => {
    const body = JSON.stringify({
      id: 'chatcmpl-abc',
      model: 'test-model',
      choices: [{ message: { role: 'assistant', content: 'Hello from local' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    const provider = makeProvider(fetchMock);
    const res = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.content).toBe('Hello from local');
    expect(res.usage.totalTokens).toBe(7);
  });

  it('should parse JSON body with trailing data: [DONE] marker', async () => {
    const jsonBody = JSON.stringify({
      id: 'chatcmpl-abc',
      model: 'test-model',
      choices: [{ message: { role: 'assistant', content: 'Works!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
    });
    const body = jsonBody + '\n\ndata: [DONE]\n';
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    const provider = makeProvider(fetchMock);
    const res = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.content).toBe('Works!');
  });

  it('should parse standard SSE streaming with delta chunks', async () => {
    const body = [
      'data: {"id":"1","model":"m","choices":[{"delta":{"role":"assistant","content":"He"},"finish_reason":null}]}',
      '',
      'data: {"id":"1","model":"m","choices":[{"delta":{"content":"llo"},"finish_reason":null}]}',
      '',
      'data: {"id":"1","model":"m","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    const provider = makeProvider(fetchMock);
    const res = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.content).toBe('Hello');
    expect(res.usage).toEqual({ promptTokens: 5, completionTokens: 2, totalTokens: 7 });
  });

  it('should handle tool_calls-only response with a clear error', async () => {
    const body = JSON.stringify({
      id: 'chatcmpl-abc',
      model: 'test-model',
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'tc1', function: { name: 'get_weather', arguments: '{}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
    });
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const provider = makeProvider(fetchMock);
    await expect(provider.generate({ messages: [{ role: 'user', content: 'weather' }] }))
      .rejects.toThrow(/tool_calls/);
  });

  it('should handle empty response body with a clear error', async () => {
    const fetchMock = vi.fn(async () => new Response('', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const provider = makeProvider(fetchMock);
    await expect(provider.generate({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow(/empty/);
  });

  it('should propagate structured error codes from provider errors', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'rate limit exceeded' },
    }), { status: 429, headers: { 'content-type': 'application/json' } }));
    const provider = makeProvider(fetchMock);
    try {
      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('PROVIDER_REQUEST_ERROR');
      expect(err.provider).toBe('test');
      expect(err.endpoint).toBe('http://localhost:20128/v1');
      expect(err.httpStatus).toBe(429);
      expect(err.message).toContain('rate limit exceeded');
    }
  });

  it('should propagate connection errors with structured metadata', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const provider = makeProvider(fetchMock);
    try {
      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('PROVIDER_CONNECTION_ERROR');
      expect(err.provider).toBe('test');
      expect(err.message).toContain('ECONNREFUSED');
    }
  });

  it('should handle non-streaming JSON from imperfect OpenAI-compatible servers', async () => {
    // Some servers return JSON with no usage and weird content-type
    const body = JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'I am a local model' } }],
    });
    const fetchMock = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }));
    const provider = makeProvider(fetchMock);
    const res = await provider.generate({ messages: [{ role: 'user', content: 'who are you' }] });
    expect(res.content).toBe('I am a local model');
  });
});

describe('LLMRouter error propagation', () => {
  it('should preserve structured error causes when all providers fail', async () => {
    const config = new ConfigManager();
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);
    const router = new LLMRouter(logger, bus);

    const failingProvider = {
      name: 'bad-provider',
      generate: async () => {
        const err = new Error('connection refused') as any;
        err.code = 'PROVIDER_CONNECTION_ERROR';
        err.provider = 'bad-provider';
        err.endpoint = 'http://localhost:9999';
        throw err;
      },
    };
    router.registerProvider(failingProvider, true);

    try {
      await router.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect.unreachable('should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('All LLM providers failed');
      expect(err.code).toBe('PROVIDER_CONNECTION_ERROR');
      expect(err.causes).toBeDefined();
      expect(err.causes).toHaveLength(1);
      expect(err.causes[0].code).toBe('PROVIDER_CONNECTION_ERROR');
      expect(err.causes[0].provider).toBe('bad-provider');
    }

    db.close();
  });
});
