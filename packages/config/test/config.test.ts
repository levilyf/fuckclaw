import { describe, it, expect } from 'vitest';
import { ConfigManager } from '../src/index.js';

describe('ConfigManager', () => {
  it('should initialize with default values', () => {
    const manager = new ConfigManager();
    const config = manager.get();
    expect(config.workspace.root).toBe('~/.fuckclaw');
    expect(config.logging.level).toBe('info');
  });

  it('should override defaults with initial config', () => {
    const manager = new ConfigManager({
      logging: { level: 'debug' },
      llm: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:20128/v1',
        apiKey: 'baby',
        model: 'kr/claude-haiku-4.5'
      }
    });
    const config = manager.get();
    expect(config.logging.level).toBe('debug');
    expect(config.workspace.root).toBe('~/.fuckclaw');
    expect(config.llm.model).toBe('kr/claude-haiku-4.5');
  });

  it('should read OpenAI-compatible settings from environment values', () => {
    const manager = ConfigManager.fromEnvironment({
      FUCKCLAW_LLM_BASE_URL: 'http://localhost:20128/v1',
      FUCKCLAW_LLM_API_KEY: 'baby',
      FUCKCLAW_LLM_MODEL: 'kr/claude-haiku-4.5'
    });

    expect(manager.get().llm).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:20128/v1',
      apiKey: 'baby',
      model: 'kr/claude-haiku-4.5'
    });
  });
});
