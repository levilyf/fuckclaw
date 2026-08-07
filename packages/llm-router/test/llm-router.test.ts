import { describe, it, expect, vi } from 'vitest';
import { LLMRouter, MockLLMProvider, OpenAICompatibleProvider } from '../src/index.js';
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
});
