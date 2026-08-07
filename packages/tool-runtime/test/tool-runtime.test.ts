import { describe, it, expect } from 'vitest';
import { ToolRuntime, ShellTool, FilesystemTool } from '../src/index.js';
import { WorkspaceManager } from '@fuckclaw/workspace';
import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import path from 'node:path';
import fs from 'node:fs';

describe('ToolRuntime RFC 09 Compliance', () => {
  it('should execute shell commands with stdout capture', async () => {
    const config = new ConfigManager();
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);
    const runtime = new ToolRuntime(logger, bus);

    runtime.register(new ShellTool());

    const result = await runtime.execute('shell', { command: 'echo "hello from tool"' });
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('hello from tool');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);

    db.close();
  });

  it('should execute complete suite of filesystem operations', async () => {
    const testDir = path.resolve('./.tool-fs-test');
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    const config = new ConfigManager({ workspace: { root: testDir } } as any);
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);
    const workspace = new WorkspaceManager(config, logger);
    await workspace.init();

    const runtime = new ToolRuntime(logger, bus);
    runtime.register(new FilesystemTool(workspace));

    // 1. mkdir
    const mkRes = await runtime.execute('filesystem', { action: 'mkdir', path: 'workspace/nested' });
    expect(mkRes.success).toBe(true);

    // 2. write
    const writeRes = await runtime.execute('filesystem', {
      action: 'write',
      path: 'workspace/nested/test.txt',
      content: 'Sample file content',
    });
    expect(writeRes.success).toBe(true);

    // 3. exists
    const exRes = await runtime.execute('filesystem', { action: 'exists', path: 'workspace/nested/test.txt' });
    expect(exRes.success).toBe(true);
    expect(exRes.output).toBe('true');

    // 4. read
    const readRes = await runtime.execute('filesystem', { action: 'read', path: 'workspace/nested/test.txt' });
    expect(readRes.success).toBe(true);
    expect(readRes.output).toBe('Sample file content');

    // 5. stat
    const statRes = await runtime.execute('filesystem', { action: 'stat', path: 'workspace/nested/test.txt' });
    expect(statRes.success).toBe(true);
    const statData = JSON.parse(statRes.output);
    expect(statData.isFile).toBe(true);

    // 6. delete
    const delRes = await runtime.execute('filesystem', { action: 'delete', path: 'workspace/nested/test.txt' });
    expect(delRes.success).toBe(true);

    const afterDel = await runtime.execute('filesystem', { action: 'exists', path: 'workspace/nested/test.txt' });
    expect(afterDel.output).toBe('false');

    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should handle unvalidated tool arguments cleanly with structured error', async () => {
    const config = new ConfigManager();
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);
    const runtime = new ToolRuntime(logger, bus);
    runtime.register(new ShellTool());

    const result = await runtime.execute('shell', { invalid: 123 } as any);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.category).toBe('internal');

    db.close();
  });
});
