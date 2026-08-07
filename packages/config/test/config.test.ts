import { describe, it, expect } from 'vitest';
import { ConfigManager } from '../src/index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('ConfigManager RFC 19 Compliance', () => {
  it('should initialize with complete canonical default configuration', () => {
    const config = new ConfigManager().get();
    expect(config.workspace.root).toBe('~/.fuckclaw');
    expect(config.system.logLevel).toBe('info');
    expect(config.system.maxConcurrentTasks).toBe(4);
    expect(config.memory.stabilityFactor).toBe(7.0);
    expect(config.budget.dailyLimitUsd).toBe(10.0);
    expect(config.scheduler.enabled).toBe(true);
  });

  it('should retrieve values with dot-notation path', () => {
    const configManager = new ConfigManager({
      system: { logLevel: 'debug', maxConcurrentTasks: 8 },
    } as any);

    expect(configManager.get('system.logLevel')).toBe('debug');
    expect(configManager.get('system.maxConcurrentTasks')).toBe(8);
    expect(configManager.get('system.nonExistent', 'fallback')).toBe('fallback');
  });

  it('should support dynamic updates and event listeners', async () => {
    const configManager = new ConfigManager();
    let updatedLevel = '';
    
    const unsubscribe = configManager.on<string>('system.logLevel', (newVal) => {
      updatedLevel = newVal;
    });

    await configManager.update('system.logLevel', 'warn');
    expect(configManager.get('system.logLevel')).toBe('warn');
    expect(updatedLevel).toBe('warn');

    unsubscribe();
  });

  it('should correctly load and merge TOML configuration files', () => {
    const tmpDir = path.join(os.tmpdir(), `fuckclaw-toml-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const tomlPath = path.join(tmpDir, 'fuckclaw.toml');

    fs.writeFileSync(
      tomlPath,
      `
[system]
logLevel = "error"
maxConcurrentTasks = 12

[budget]
dailyLimitUsd = 42.50

[llm]
model = "claude-3-7-sonnet"
baseUrl = "https://api.example.com/v1"
apiKey = "sk-test-secret-key-12345"
`,
      'utf8'
    );

    const configManager = new ConfigManager({
      projectConfigPath: tomlPath,
    });

    expect(configManager.get('system.logLevel')).toBe('error');
    expect(configManager.get('system.maxConcurrentTasks')).toBe(12);
    expect(configManager.get('budget.dailyLimitUsd')).toBe(42.5);
    expect(configManager.get('llm.model')).toBe('claude-3-7-sonnet');

    // Test secret redaction
    const redacted = configManager.dumpRedacted();
    expect((redacted.llm as any).apiKey).toBe('[REDACTED]');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should parse environment variables correctly', () => {
    const configManager = ConfigManager.fromEnvironment({
      FUCKCLAW_WORKSPACE_ROOT: '/custom/workspace',
      FUCKCLAW_LOG_LEVEL: 'debug',
      FUCKCLAW_LLM_BASE_URL: 'https://api.test.com/v1',
      FUCKCLAW_LLM_API_KEY: 'secret-key-abc',
      FUCKCLAW_LLM_MODEL: 'test-model-v1',
    });

    const config = configManager.get();
    expect(config.workspace.root).toBe('/custom/workspace');
    expect(config.system.logLevel).toBe('debug');
    expect(config.llm?.baseUrl).toBe('https://api.test.com/v1');
    expect(config.llm?.apiKey).toBe('secret-key-abc');
  });
});
