import { describe, it, expect, vi } from 'vitest';
import { LLMRouter, MockLLMProvider } from '../src/index.js';
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
});
