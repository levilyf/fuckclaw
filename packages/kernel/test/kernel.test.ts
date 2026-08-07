import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentKernel, KernelState, TaskState } from '../src/index.js';
import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import { WorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime, ShellTool, FilesystemTool } from '@fuckclaw/tool-runtime';
import { LLMRouter, MockLLMProvider } from '@fuckclaw/llm-router';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('AgentKernel', () => {
  let tempDir: string;
  let kernel: AgentKernel;
  let persistence: PersistenceLayer;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuckclaw-kernel-test-'));
    const config = new ConfigManager({ workspace: { root: tempDir } });
    const logger = new Logger(config);
    persistence = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(persistence, logger);
    const ws = new WorkspaceManager(config, logger);
    const toolRuntime = new ToolRuntime(logger, bus);
    toolRuntime.register(new ShellTool());
    toolRuntime.register(new FilesystemTool(ws));

    const llmRouter = new LLMRouter(logger, bus);
    llmRouter.registerProvider(new MockLLMProvider('mock', 'Mock response'));

    kernel = new AgentKernel(config, logger, persistence, bus, ws, toolRuntime, llmRouter);
  });

  afterEach(async () => {
    persistence.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should boot and transition to IDLE state', async () => {
    expect(kernel.getState()).toBe(KernelState.BOOTING);
    await kernel.boot();
    expect(kernel.getState()).toBe(KernelState.IDLE);
  });

  it('should accept and process a task through reasoning engine runner', async () => {
    await kernel.boot();

    kernel.setReasoningEngine({
      async runTask(task, context) {
        return {
          output: `Processed task ${task.description}`,
          steps: [
            {
              step: 1,
              thought: 'I will process this task directly',
              action: 'none',
              success: true,
            },
          ],
        };
      },
    });

    const task = await kernel.submitTask({
      description: 'Run unit test task',
      priority: 10,
    });

    expect(task.state).toBe(TaskState.COMPLETED);
    expect(task.output).toBe('Processed task Run unit test task');
    expect(task.results.length).toBe(1);
  });

  it('should cleanly shutdown and cancel active tasks if draining', async () => {
    await kernel.boot();
    await kernel.shutdown();
    expect(kernel.getState()).toBe(KernelState.SHUTTING_DOWN);
  });
});
