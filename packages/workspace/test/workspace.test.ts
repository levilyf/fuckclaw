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

  it('should create compressed snapshot archive, verify SHA-256 integrity, and rollback (§7.6)', async () => {
    await workspace.init();

    // 1. Create sample files in workspace
    const wsDir = workspace.getDirectory('workspace');
    fs.mkdirSync(path.join(wsDir, 'projects', 'auth-service'), { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'projects', 'auth-service', 'index.ts'), 'export const auth = "v1.0";', 'utf8');
    fs.writeFileSync(path.join(wsDir, 'config.json'), '{"active": true}', 'utf8');

    // 2. Create snapshot
    const snapshotName = 'pre-task-checkpoint-001';
    const snapshotPath = await workspace.createSnapshot(snapshotName);
    expect(fs.existsSync(snapshotPath)).toBe(true);

    const snapshots = await workspace.listSnapshots();
    expect(snapshots).toContain(snapshotName);

    // 3. Verify snapshot integrity
    const isValid = await workspace.verifySnapshot(snapshotName);
    expect(isValid).toBe(true);

    // 4. Mutate and delete files in workspace
    fs.writeFileSync(path.join(wsDir, 'projects', 'auth-service', 'index.ts'), 'export const auth = "CORRUPTED";', 'utf8');
    fs.unlinkSync(path.join(wsDir, 'config.json'));
    expect(fs.existsSync(path.join(wsDir, 'config.json'))).toBe(false);

    // 5. Rollback to snapshot
    const rolledBack = await workspace.rollbackToSnapshot(snapshotName);
    expect(rolledBack).toBe(true);

    // 6. Verify exact restoration
    expect(fs.existsSync(path.join(wsDir, 'config.json'))).toBe(true);
    expect(fs.readFileSync(path.join(wsDir, 'config.json'), 'utf8')).toBe('{"active": true}');
    expect(fs.readFileSync(path.join(wsDir, 'projects', 'auth-service', 'index.ts'), 'utf8')).toBe('export const auth = "v1.0";');
  });
});
