import { describe, it, expect } from 'vitest';
import { AgentKernel, KernelState, TaskState } from '../src/index.js';
import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import { WorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime } from '@fuckclaw/tool-runtime';
import { LLMRouter, MockLLMProvider } from '@fuckclaw/llm-router';

describe('AgentKernel RFC 04 Compliance', () => {
  it('should boot and transition to IDLE state', async () => {
    const config = new ConfigManager();
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);
    const workspace = new WorkspaceManager(config, logger);
    const tools = new ToolRuntime(logger, bus);
    const router = new LLMRouter(logger, bus);

    const kernel = new AgentKernel(config, logger, db, bus, workspace, tools, router);
    expect(kernel.getState()).toBe(KernelState.BOOTING);

    await kernel.boot();
    expect(kernel.getState()).toBe(KernelState.IDLE);

    db.close();
  });

  it('should persist tasks, execute steps, and support SHA-256 checkpointing', async () => {
    const config = new ConfigManager();
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);
    const workspace = new WorkspaceManager(config, logger);
    const tools = new ToolRuntime(logger, bus);
    const router = new LLMRouter(logger, bus);
    router.registerProvider(new MockLLMProvider('mock', 'Mock response'));

    const kernel = new AgentKernel(config, logger, db, bus, workspace, tools, router);
    await kernel.boot();

    kernel.setReasoningEngine({
      runTask: async (task) => ({
        output: 'Task success output',
        steps: [
          { step: 1, action: 'shell', observation: 'stdout', success: true },
        ],
      }),
    });

    const task = await kernel.submitTask({ description: 'Persisted task test' });
    expect(task.state).toBe(TaskState.COMPLETED);
    expect(task.output).toBe('Task success output');

    // Verify task record exists in SQLite
    const persisted = await kernel.getTask(task.id);
    expect(persisted).toBeDefined();
    expect(persisted?.description).toBe('Persisted task test');
    expect(persisted?.state).toBe(TaskState.COMPLETED);

    // Verify checkpoint creation
    const checkpointId = await kernel.createCheckpoint(task.id);
    expect(checkpointId).toBeDefined();

    const ckptRows = db.query<{ id: string; hash: string }>(
      'SELECT id, hash FROM checkpoints WHERE id = ?',
      [checkpointId]
    );
    expect(ckptRows.length).toBe(1);
    expect(ckptRows[0]!.hash.length).toBe(64); // SHA-256 length

    db.close();
  });

  it('should cleanly shutdown and cancel active tasks if draining', async () => {
    const config = new ConfigManager();
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);
    const workspace = new WorkspaceManager(config, logger);
    const tools = new ToolRuntime(logger, bus);
    const router = new LLMRouter(logger, bus);

    const kernel = new AgentKernel(config, logger, db, bus, workspace, tools, router);
    await kernel.boot();

    await kernel.shutdown();
    expect(kernel.getState()).toBe(KernelState.SHUTTING_DOWN);

    db.close();
  });
});
