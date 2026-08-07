import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceManager } from '../src/index.js';
import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('WorkspaceManager', () => {
  let tempDir: string;
  let workspace: WorkspaceManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuckclaw-ws-test-'));
    const config = new ConfigManager({
      workspace: { root: tempDir }
    });
    const logger = new Logger(config);
    workspace = new WorkspaceManager(config, logger);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should initialize and create canonical directory layout', async () => {
    await workspace.init();

    const expectedDirs = [
      'config',
      'data',
      'workspace',
      'logs',
      'cache',
      'plugins',
      'skills',
      'snapshots'
    ];

    for (const dir of expectedDirs) {
      expect(fs.existsSync(path.join(tempDir, dir))).toBe(true);
    }
  });

  it('should resolve workspace paths correctly', () => {
    const configPath = workspace.resolvePath('config', 'fuckclaw.toml');
    expect(configPath).toBe(path.join(tempDir, 'config', 'fuckclaw.toml'));
  });
});
