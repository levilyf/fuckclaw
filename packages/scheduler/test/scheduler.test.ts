import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Scheduler, CronRunner, ScheduleTrigger } from '../src/index.js';
import { AgentKernel, TaskState, Task } from '@fuckclaw/kernel';
import { EventBus } from '@fuckclaw/event-bus';
import { Logger } from '@fuckclaw/observability';
import { ConfigManager } from '@fuckclaw/config';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { WorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime } from '@fuckclaw/tool-runtime';
import { LLMRouter } from '@fuckclaw/llm-router';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function createMockInfrastructure(customRoot?: string) {
  const root = customRoot || ':memory:';
  const config = new ConfigManager({
    workspace: { root },
    logging: { level: 'error' },
  });
  const logger = new Logger(config);
  const db = new PersistenceLayer(':memory:', logger);
  const bus = new EventBus(db, logger);
  const workspace = new WorkspaceManager(config, logger);
  const toolRuntime = new ToolRuntime(logger, bus);
  const llmRouter = new LLMRouter(logger, bus);

  const kernel = new AgentKernel(
    config,
    logger,
    db,
    bus,
    workspace,
    toolRuntime,
    llmRouter
  );

  return { config, logger, db, bus, workspace, toolRuntime, llmRouter, kernel };
}

describe('CronRunner', () => {
  it('should correctly evaluate standard 5-part cron expressions', () => {
    const { logger } = createMockInfrastructure();
    const runner = new CronRunner(logger, async () => {});

    const testDate = new Date(2026, 7, 8, 3, 0, 0); // Local 3:00 AM
    expect(runner.matchesCron('* * * * *', testDate)).toBe(true);
    expect(runner.matchesCron('0 3 * * *', testDate)).toBe(true);
    expect(runner.matchesCron('0 4 * * *', testDate)).toBe(false);
    expect(runner.matchesCron('*/5 * * * *', testDate)).toBe(true);
  });
});

describe('Scheduler Integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `fuckclaw-scheduler-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should trigger and execute tasks from interval triggers', async () => {
    const { kernel, logger, bus, workspace } = createMockInfrastructure(tmpDir);
    await workspace.init();

    kernel.setReasoningEngine({
      async runTask(task: Task) {
        return {
          output: `Task executed: ${task.description}`,
          steps: [{ step: 1, action: 'finish', observation: 'Done', success: true }],
        };
      },
    });
    await kernel.boot();

    const scheduler = new Scheduler(kernel, logger, bus, workspace);

    const trigger: ScheduleTrigger = {
      id: 'test-interval',
      name: 'Test Interval Trigger',
      enabled: true,
      source: { type: 'interval', intervalMs: 50 },
      taskTemplate: {
        description: 'Run recurring health check',
        priority: 70,
      },
      stats: { totalFired: 0, lastFired: 0, lastResult: null },
    };

    scheduler.registerTrigger(trigger);
    await scheduler.start();

    // Allow interval to fire at least once
    await new Promise((resolve) => setTimeout(resolve, 150));

    await scheduler.stop();
    await kernel.shutdown();

    const updatedTrigger = scheduler.getTrigger('test-interval');
    expect(updatedTrigger!.stats.totalFired).toBeGreaterThanOrEqual(1);
    expect(updatedTrigger!.stats.lastResult).toBe('success');
  });

  it('should handle incoming webhooks and submit tasks to Kernel', async () => {
    const { kernel, logger, bus, workspace } = createMockInfrastructure(tmpDir);
    await workspace.init();

    kernel.setReasoningEngine({
      async runTask(task: Task) {
        return {
          output: `Processed webhook task: ${task.description}`,
          steps: [{ step: 1, action: 'finish', observation: 'OK', success: true }],
        };
      },
    });
    await kernel.boot();

    const scheduler = new Scheduler(kernel, logger, bus, workspace);

    const webhookTrigger: ScheduleTrigger = {
      id: 'gh-pr-review',
      name: 'GitHub PR Review Webhook',
      enabled: true,
      source: {
        type: 'webhook',
        path: '/api/webhooks/github',
        method: 'POST',
        secret: 'secret-token-123',
      },
      taskTemplate: {
        description: 'Review PR from webhook payload',
        priority: 30,
      },
      stats: { totalFired: 0, lastFired: 0, lastResult: null },
    };

    scheduler.registerTrigger(webhookTrigger);
    await scheduler.start();

    // 1. Unauthorized attempt
    const unauthRes = await scheduler.handleWebhook({
      path: '/api/webhooks/github',
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret' },
    });
    expect(unauthRes.statusCode).toBe(401);

    // 2. Authorized attempt
    const authRes = await scheduler.handleWebhook({
      path: '/api/webhooks/github',
      method: 'POST',
      headers: { authorization: 'Bearer secret-token-123' },
      body: { prNumber: 42 },
    });
    expect(authRes.statusCode).toBe(200);
    expect(authRes.taskId).toBeDefined();

    const triggerStats = scheduler.getTrigger('gh-pr-review')!.stats;
    expect(triggerStats.totalFired).toBe(1);
    expect(triggerStats.lastResult).toBe('success');

    await scheduler.stop();
    await kernel.shutdown();
  });

  it('should debounce filesystem file watch triggers and execute task on modification', async () => {
    const { kernel, logger, bus, workspace } = createMockInfrastructure(tmpDir);
    await workspace.init();

    const watchFile = path.join(tmpDir, 'input.txt');
    fs.writeFileSync(watchFile, 'Initial content');

    kernel.setReasoningEngine({
      async runTask(task: Task) {
        return {
          output: `Processed file modification: ${task.description}`,
          steps: [{ step: 1, action: 'finish', observation: 'Processed', success: true }],
        };
      },
    });
    await kernel.boot();

    const scheduler = new Scheduler(kernel, logger, bus, workspace);

    const fsTrigger: ScheduleTrigger = {
      id: 'watch-input-txt',
      name: 'Watch Input File',
      enabled: true,
      source: {
        type: 'file_watch',
        paths: [watchFile],
        events: ['modify'],
        debounceMs: 50,
      },
      taskTemplate: {
        description: 'Process updated input file',
        priority: 50,
      },
      stats: { totalFired: 0, lastFired: 0, lastResult: null },
    };

    scheduler.registerTrigger(fsTrigger);
    await scheduler.start();

    // Rapid writes to test debouncing
    fs.appendFileSync(watchFile, '\nLine 1');
    fs.appendFileSync(watchFile, '\nLine 2');
    fs.appendFileSync(watchFile, '\nLine 3');

    // Wait for debounced watcher to trigger
    await new Promise((resolve) => setTimeout(resolve, 250));

    await scheduler.stop();
    await kernel.shutdown();

    const triggerStats = scheduler.getTrigger('watch-input-txt')!.stats;
    expect(triggerStats.totalFired).toBeGreaterThanOrEqual(1);
    expect(triggerStats.lastResult).toBe('success');
  });
});
