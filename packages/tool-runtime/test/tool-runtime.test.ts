import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRuntime, ShellTool, FilesystemTool } from '../src/index.js';
import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import { WorkspaceManager } from '@fuckclaw/workspace';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('ToolRuntime', () => {
  let runtime: ToolRuntime;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuckclaw-tool-test-'));
    const config = new ConfigManager({ workspace: { root: tempDir } });
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);
    const ws = new WorkspaceManager(config, logger);
    await ws.init();

    runtime = new ToolRuntime(logger, bus);
    runtime.register(new ShellTool());
    runtime.register(new FilesystemTool(ws));
  });

  it('should execute shell commands with stdout capture', async () => {
    const result = await runtime.execute('shell', { command: 'echo "hello fuckclaw"' });
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('hello fuckclaw');
  });

  it('should execute filesystem write and read operations', async () => {
    const writeResult = await runtime.execute('filesystem', {
      action: 'write',
      path: 'workspace/test.txt',
      content: 'hello from fs tool'
    });
    expect(writeResult.success).toBe(true);

    const readResult = await runtime.execute('filesystem', {
      action: 'read',
      path: 'workspace/test.txt'
    });
    expect(readResult.success).toBe(true);
    expect(readResult.output).toBe('hello from fs tool');
  });

  it('should reject unvalidated tool arguments', async () => {
    const result = await runtime.execute('shell', { invalid: 123 } as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Validation error');
  });
});
