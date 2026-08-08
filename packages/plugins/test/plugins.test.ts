import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginManager } from '../src/plugin-manager.js';
import { Plugin, PluginContext, PluginManifest } from '../src/types.js';
import { ToolRuntime, IToolRuntime, FilesystemTool, ShellTool } from '@fuckclaw/tool-runtime';
import { WorkspaceManager, IWorkspaceManager } from '@fuckclaw/workspace';
import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import { Task, TaskState } from '@fuckclaw/kernel';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('Plugin System Subsystem (@fuckclaw/plugins)', () => {
  let toolRuntime: IToolRuntime;
  let workspace: IWorkspaceManager;
  let pluginManager: PluginManager;
  let bus: EventBus;
  let db: PersistenceLayer;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `.fuckclaw-plugin-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const config = new ConfigManager({ workspace: { root: tempDir } } as any);
    const logger = new Logger(config);
    workspace = new WorkspaceManager(config, logger);

    db = new PersistenceLayer(':memory:', logger);
    bus = new EventBus(db, logger);

    toolRuntime = new ToolRuntime(logger, bus);
    toolRuntime.register(new FilesystemTool(workspace));
    toolRuntime.register(new ShellTool());

    pluginManager = new PluginManager(bus, toolRuntime, logger, workspace);
  });

  afterEach(async () => {
    await pluginManager.shutdown();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads, initializes, and registers custom tools from a plugin', async () => {
    let initialized = false;
    let registeredToolCalled = false;

    const samplePlugin: Plugin = {
      async onInit(ctx: PluginContext) {
        initialized = true;
        ctx.toolRegistry.register({
          name: 'slack_send_message',
          description: 'Send a message to a Slack channel',
          execute: async (params: any) => {
            registeredToolCalled = true;
            return {
              success: true,
              output: `Slack message sent to #${params.channel}: ${params.text}`,
              executionTimeMs: 15,
            };
          },
        });
      },
      async healthCheck() {
        return { healthy: true, message: 'Slack API connected' };
      },
    };

    const manifest: PluginManifest = {
      id: 'fuckclaw-plugin-slack',
      name: 'Slack Integration',
      version: '1.0.0',
      description: 'Slack notification and channel integration plugin',
      author: { name: 'FuckClaw Dev' },
      main: 'dist/index.js',
      capabilities: [{ type: 'tool', tools: ['slack_send_message'] }],
      requirements: { minVersion: '1.0.0' },
    };

    await pluginManager.load(manifest, samplePlugin);

    expect(initialized).toBe(true);
    expect(pluginManager.list().length).toBe(1);
    expect(pluginManager.get('fuckclaw-plugin-slack')?.state).toBe('active');

    // Verify tool was registered in ToolRuntime
    expect(toolRuntime.has('slack_send_message')).toBe(true);
    const execResult = await toolRuntime.execute('slack_send_message', {
      channel: 'general',
      text: 'Milestone 7 testing in progress',
    });

    expect(registeredToolCalled).toBe(true);
    expect(execResult.success).toBe(true);
    expect(execResult.output).toBe('Slack message sent to #general: Milestone 7 testing in progress');

    // Verify healthCheck
    const health = await pluginManager.healthCheck();
    expect(health['fuckclaw-plugin-slack'].healthy).toBe(true);
    expect(health['fuckclaw-plugin-slack'].message).toBe('Slack API connected');
  });

  it('invokes lifecycle hooks onTaskCreated and onTaskCompleted', async () => {
    let capturedTaskCreate: Task | undefined;
    let capturedTaskComplete: { task: Task; result: unknown } | undefined;

    const auditPlugin: Plugin = {
      async onInit(_ctx) {},
      async onTaskCreated(task, _ctx) {
        capturedTaskCreate = task;
      },
      async onTaskCompleted(task, result, _ctx) {
        capturedTaskComplete = { task, result };
      },
    };

    const manifest: PluginManifest = {
      id: 'fuckclaw-plugin-auditor',
      name: 'Audit Logger Plugin',
      version: '1.0.0',
      description: 'Logs task events',
      author: { name: 'FuckClaw' },
      main: 'dist/index.js',
      capabilities: [{ type: 'event_handler', events: ['task.*'] }],
      requirements: { minVersion: '1.0.0' },
    };

    await pluginManager.load(manifest, auditPlugin);

    const testTask: Task = {
      id: 'task_123',
      type: 'goal',
      payload: { goal: 'Test plugin hooks' },
      priority: 10,
      state: TaskState.EXECUTING,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await pluginManager.invokeTaskCreatedHook(testTask);
    expect(capturedTaskCreate?.id).toBe('task_123');

    await pluginManager.invokeTaskCompletedHook(testTask, { summary: 'Completed successfully' });
    expect(capturedTaskComplete?.task.id).toBe('task_123');
    expect(capturedTaskComplete?.result).toEqual({ summary: 'Completed successfully' });
  });

  it('discovers plugins from filesystem directory', async () => {
    const pluginsDir = path.join(tempDir, 'plugins', 'registry');
    const myPluginDir = path.join(pluginsDir, 'my-plugin');
    fs.mkdirSync(myPluginDir, { recursive: true });

    const manifestJson: PluginManifest = {
      id: 'fuckclaw-plugin-discovery-test',
      name: 'Discovery Plugin',
      version: '1.2.0',
      description: 'Tests directory scanning',
      author: { name: 'Dev' },
      main: 'index.js',
      capabilities: [],
      requirements: { minVersion: '1.0.0' },
    };

    fs.writeFileSync(path.join(myPluginDir, 'plugin.json'), JSON.stringify(manifestJson, null, 2), 'utf8');

    const discovered = await pluginManager.discover(pluginsDir);
    expect(discovered.length).toBe(1);
    expect(discovered[0].id).toBe('fuckclaw-plugin-discovery-test');
    expect(discovered[0].version).toBe('1.2.0');
  });

  it('gracefully unloads and invokes onShutdown', async () => {
    let shutDownCalled = false;

    const samplePlugin: Plugin = {
      async onInit(_ctx) {},
      async onShutdown(_ctx) {
        shutDownCalled = true;
      },
    };

    const manifest: PluginManifest = {
      id: 'fuckclaw-plugin-lifecycle',
      name: 'Lifecycle Plugin',
      version: '1.0.0',
      description: 'Testing shutdown hook',
      author: { name: 'Dev' },
      main: 'index.js',
      capabilities: [],
      requirements: { minVersion: '1.0.0' },
    };

    await pluginManager.load(manifest, samplePlugin);
    expect(pluginManager.get('fuckclaw-plugin-lifecycle')?.state).toBe('active');

    await pluginManager.unload('fuckclaw-plugin-lifecycle');
    expect(shutDownCalled).toBe(true);
    expect(pluginManager.get('fuckclaw-plugin-lifecycle')).toBeUndefined();
  });
});
