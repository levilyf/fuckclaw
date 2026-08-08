import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NetworkManager } from '../src/network-manager.js';
import { AgentKernel } from '@fuckclaw/kernel';
import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import { WorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime, FilesystemTool, ShellTool } from '@fuckclaw/tool-runtime';
import { LLMRouter, ILLMProvider } from '@fuckclaw/llm-router';
import { ReasoningEngine } from '@fuckclaw/reasoning';
import WebSocket from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

class MockNetworkLLMProvider implements ILLMProvider {
  name = 'mock-llm';
  async generate() {
    return {
      content: 'Network task response from FuckClaw',
      provider: 'mock-llm',
      model: 'mock-v1',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      costUsd: 0.0001,
    };
  }
}

describe('Networking & Gateway Subsystem (@fuckclaw/network)', () => {
  let kernel: AgentKernel;
  let eventBus: EventBus;
  let networkManager: NetworkManager;
  let db: PersistenceLayer;
  let tempDir: string;
  let baseUrl: string;
  let port: number;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `.fuckclaw-network-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const config = new ConfigManager({ workspace: { root: tempDir } } as any);
    const logger = new Logger(config);
    db = new PersistenceLayer(':memory:', logger);
    eventBus = new EventBus(db, logger);
    const workspace = new WorkspaceManager(config, logger);

    const toolRuntime = new ToolRuntime(logger, eventBus);
    toolRuntime.register(new FilesystemTool(workspace));
    toolRuntime.register(new ShellTool());

    const llmRouter = new LLMRouter(logger, eventBus);
    llmRouter.registerProvider(new MockNetworkLLMProvider(), true);
    const reasoning = new ReasoningEngine(logger, eventBus, toolRuntime, llmRouter);

    kernel = new AgentKernel(config, logger, db, eventBus, workspace, toolRuntime, llmRouter);
    kernel.setReasoningEngine(reasoning);
    await kernel.boot();

    // Pick random available test port (port 0 lets OS assign)
    networkManager = new NetworkManager(
      kernel,
      eventBus,
      logger,
      {
        host: '127.0.0.1',
        port: 0,
        enableWebSocket: true,
      },
      undefined,
      undefined,
      toolRuntime
    );

    const addr = await networkManager.start();
    port = addr.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await networkManager.stop();
    await kernel.shutdown();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('HTTP REST API', () => {
    it('GET /api/system/health returns healthy system status', async () => {
      const res = await fetch(`${baseUrl}/api/system/health`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: string; version: string; kernelState: string };
      expect(data.status).toBe('healthy');
      expect(data.version).toBe('1.0.0');
      expect(data.kernelState).toBe('idle');
    });

    it('GET /api/tools lists registered tools', async () => {
      const res = await fetch(`${baseUrl}/api/tools`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { count: number; tools: Array<{ name: string }> };
      expect(data.count).toBeGreaterThanOrEqual(2);
      expect(data.tools.some((t) => t.name === 'filesystem')).toBe(true);
      expect(data.tools.some((t) => t.name === 'shell')).toBe(true);
    });

    it('POST /api/tasks executes a synchronous task', async () => {
      const res = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Hello over HTTP REST' }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { taskId: string; state: string; output: string };
      expect(data.taskId).toBeDefined();
      expect(data.state).toBe('completed');
      expect(data.output).toContain('Network task response');
    });

    it('POST /api/tasks (async) returns task status immediately', async () => {
      const res = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Async task test', async: true }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: string; async: boolean; description: string };
      expect(data.status).toBe('accepted');
      expect(data.async).toBe(true);
      expect(data.description).toBe('Async task test');
    });

    it('supports custom route registration for plugins', async () => {
      networkManager.registerRoute('GET', '/api/custom/ping', async () => {
        return { message: 'pong from plugin custom route' };
      });

      const res = await fetch(`${baseUrl}/api/custom/ping`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { message: string };
      expect(data.message).toBe('pong from plugin custom route');
    });
  });

  describe('WebSocket Realtime Streaming', () => {
    it('connects to WebSocket server and receives broadcast events', async () => {
      const wsUrl = `ws://127.0.0.1:${port}`;
      const ws = new WebSocket(wsUrl);

      const receivedMessages: any[] = [];

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', reject);
        ws.on('message', (data) => {
          try {
            receivedMessages.push(JSON.parse(data.toString('utf8')));
          } catch {
            // ignore
          }
        });
      });

      // Send a ping
      ws.send(JSON.stringify({ type: 'ping' }));

      // Wait for pong and initial greeting
      await new Promise((r) => setTimeout(r, 100));

      expect(receivedMessages.some((m) => m.type === 'event')).toBe(true);
      expect(receivedMessages.some((m) => m.type === 'pong')).toBe(true);

      ws.close();
    });
  });
});
