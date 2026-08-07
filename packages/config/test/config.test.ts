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
      logging: { level: 'debug' }
    });
    const config = manager.get();
    expect(config.logging.level).toBe('debug');
    expect(config.workspace.root).toBe('~/.fuckclaw');
  });
});
