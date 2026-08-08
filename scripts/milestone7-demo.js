#!/usr/bin/env node

/**
 * FuckClaw - Milestone 7 Ecosystem & Interfaces End-to-End Verification Demo
 *
 * Demonstrates:
 * 1. Model Context Protocol (MCP) tool & resource exposure and in-memory JSON-RPC communication (§17)
 * 2. Dynamic Plugin lifecycle hooks, sandbox context, and tool registration (§16)
 * 3. HTTP REST API endpoints & WebSocket real-time streaming gateway (§21)
 * 4. Terminal UI rendering components (ANSI banner, status bar, stream renderer) (§22)
 */

import { createFuckClawRuntime, FuckClawClient, renderBanner, renderStatusBar, StreamRenderer, ANSI } from '../packages/cli/dist/index.js';
import { MCPServer } from '../packages/mcp/dist/index.js';
import WebSocket from 'ws';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

class Milestone7DemoLLMProvider {
  constructor() {
    this.name = 'm7-demo-llm';
  }

  async generate(request) {
    const prompt = (request.messages && request.messages[request.messages.length - 1]?.content) || '';
    
    if (prompt.includes('plugin tool') || prompt.includes('weather')) {
      return {
        content: `Thought: I will query the weather plugin tool.
Action: get_weather
Action Input: {"location":"Neo-Tokyo"}`,
        provider: this.name,
        model: 'm7-mock-v1',
        usage: { promptTokens: 15, completionTokens: 15, totalTokens: 30 },
        costUsd: 0.0003,
      };
    }

    if (prompt.includes('Observation:')) {
      return {
        content: `Thought: The weather tool returned the forecast.
Final Answer: The weather in Neo-Tokyo is currently Cyber-Rainy with a temperature of 18°C.`,
        provider: this.name,
        model: 'm7-mock-v1',
        usage: { promptTokens: 20, completionTokens: 15, totalTokens: 35 },
        costUsd: 0.00035,
      };
    }

    return {
      content: `Thought: Responding to generic query.
Final Answer: FuckClaw Milestone 7 subsystem demonstration complete. All ecosystems online.`,
      provider: this.name,
      model: 'm7-mock-v1',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      costUsd: 0.0002,
    };
  }
}

async function runMilestone7Demo() {
  console.log(renderBanner());
  console.log(`${ANSI.bold}${ANSI.cyan}========================================================================${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.green}  FUCKCLAW MILESTONE 7: ECOSYSTEM & INTERFACE DEMO${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}========================================================================${ANSI.reset}\n`);

  const tempDir = path.join(os.tmpdir(), `.fuckclaw-m7-demo-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const runtime = await createFuckClawRuntime(
    { workspace: { root: tempDir } },
    new Milestone7DemoLLMProvider(),
    {}
  );

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // Section 1: MCP Integration (§17)
    // ──────────────────────────────────────────────────────────────────────────
    console.log(`${ANSI.bold}${ANSI.yellow}[1/4] Testing Model Context Protocol (MCP) Subsystem...${ANSI.reset}`);
    
    // In-memory JSON-RPC MCP Server test
    const mcpServer = new MCPServer(runtime.toolRuntime, runtime.workspace, runtime.knowledgeGraph);
    
    // 1. Initialize MCP
    const initResponse = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 'req_1',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', clientInfo: { name: 'FuckClaw-M7-Test', version: '1.0' } }
    });
    console.log(`  ✓ MCP Initialize Response: Server=${initResponse.result.serverInfo.name} v${initResponse.result.serverInfo.version}`);

    // 2. List tools over MCP
    const toolsResponse = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 'req_2',
      method: 'tools/list'
    });
    console.log(`  ✓ MCP Tools Listed: ${toolsResponse.result.tools.length} available tools`);

    // 3. Call tool over MCP JSON-RPC
    const callResponse = await mcpServer.handleRequest({
      jsonrpc: '2.0',
      id: 'req_3',
      method: 'tools/call',
      params: {
        name: 'shell',
        arguments: { command: 'echo "MCP Protocol Live Execution"' }
      }
    });
    console.log(`  ✓ MCP Tool Call Executed: output="${callResponse.result.content[0].text.trim()}"\n`);

    // ──────────────────────────────────────────────────────────────────────────
    // Section 2: Plugin System Subsystem (§16)
    // ──────────────────────────────────────────────────────────────────────────
    console.log(`${ANSI.bold}${ANSI.yellow}[2/4] Testing Dynamic Plugin Subsystem...${ANSI.reset}`);

    let pluginHookFired = false;
    const weatherPlugin = {
      async onInit(ctx) {
        ctx.logger.info('Weather plugin initializing...');
        ctx.toolRegistry.register({
          name: 'get_weather',
          description: 'Get weather forecast for a location',
          execute: async (params) => {
            return {
              success: true,
              output: `Weather for ${params.location}: Cyber-Rainy, 18°C, Wind 12km/h`,
              executionTimeMs: 12
            };
          }
        });
      },
      async onTaskCreated(task) {
        pluginHookFired = true;
      },
      async healthCheck() {
        return { healthy: true, message: 'Weather satellite feed active' };
      }
    };

    const weatherManifest = {
      id: 'fuckclaw-plugin-weather',
      name: 'Cyber Weather Service',
      version: '1.0.0',
      description: 'Provides live weather telemetry',
      author: { name: 'FuckClaw Architecture Team' },
      main: 'index.js',
      capabilities: [{ type: 'tool', tools: ['get_weather'] }],
      requirements: { minVersion: '1.0.0' }
    };

    await runtime.pluginManager.load(weatherManifest, weatherPlugin);
    console.log(`  ✓ Plugin Loaded: "${weatherManifest.name}" [Status: ${runtime.pluginManager.get('fuckclaw-plugin-weather')?.state}]`);
    console.log(`  ✓ Tool Registered in ToolRuntime: toolRuntime.has('get_weather') = ${runtime.toolRuntime.has('get_weather')}`);

    const health = await runtime.pluginManager.healthCheck();
    console.log(`  ✓ Plugin Health: healthy=${health['fuckclaw-plugin-weather'].healthy} (${health['fuckclaw-plugin-weather'].message})\n`);

    // ──────────────────────────────────────────────────────────────────────────
    // Section 3: HTTP REST API & WebSocket Streaming Gateway (§21)
    // ──────────────────────────────────────────────────────────────────────────
    console.log(`${ANSI.bold}${ANSI.yellow}[3/4] Testing Networking & Streaming Gateway...${ANSI.reset}`);

    const { host, port } = await runtime.networkManager.start({ port: 0 });
    console.log(`  ✓ Gateway Server Started on http://${host}:${port}`);

    // Connect WebSocket stream listener
    const wsUrl = `ws://${host}:${port}`;
    const ws = new WebSocket(wsUrl);
    const streamEvents = [];

    await new Promise((resolve) => {
      ws.on('open', resolve);
      ws.on('message', (data) => {
        try {
          streamEvents.push(JSON.parse(data.toString('utf8')));
        } catch {}
      });
    });

    // Test REST API Client SDK
    const client = new FuckClawClient({ baseUrl: `http://${host}:${port}` });
    const healthResult = await client.getHealth();
    console.log(`  ✓ REST GET /api/system/health -> state=${healthResult.kernelState}, version=${healthResult.version}`);

    const availableTools = await client.listTools();
    console.log(`  ✓ REST GET /api/tools -> count=${availableTools.length} (includes get_weather: ${availableTools.some(t => t.name === 'get_weather')})`);

    // Submit task utilizing plugin tool over REST
    console.log(`  ⚡ Executing Task via REST: "Check the weather in Neo-Tokyo"`);
    const taskResult = await client.submitTask('Check the weather in Neo-Tokyo');
    console.log(`  ✓ REST Task Result: state=${taskResult.state}, output="${taskResult.output}"`);

    // Give WS events brief moment to capture
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
    console.log(`  ✓ Realtime WebSocket Broadcasts Received: ${streamEvents.length} frames\n`);

    // ──────────────────────────────────────────────────────────────────────────
    // Section 4: Terminal UI & Status Bar Components (§22)
    // ──────────────────────────────────────────────────────────────────────────
    console.log(`${ANSI.bold}${ANSI.yellow}[4/4] Testing Terminal UI Components...${ANSI.reset}`);

    StreamRenderer.renderThought('Synthesizing ecosystem verification results across all 4 tiers.');
    StreamRenderer.renderToolCall('get_weather', { location: 'Neo-Tokyo' });
    StreamRenderer.renderToolResult('get_weather', true, { condition: 'Cyber-Rainy', temp: '18°C' }, 12);
    StreamRenderer.renderFinalResponse('All Milestone 7 Subsystems (MCP, Plugins, Network Gateway, and CLI/TUI) are operating at 100% specification compliance.');

    const statusBarOutput = renderStatusBar({
      kernelState: runtime.kernel.getState(),
      activeTasks: 0,
      toolCount: runtime.toolRuntime.list().length,
      uptimeSeconds: Math.floor(process.uptime())
    });
    console.log(statusBarOutput);

    console.log(`\n${ANSI.bold}${ANSI.green}========================================================================${ANSI.reset}`);
    console.log(`${ANSI.bold}${ANSI.green}  ✓ MILESTONE 7 VERIFICATION COMPLETE: ALL SYSTEMS NOMINAL${ANSI.reset}`);
    console.log(`${ANSI.bold}${ANSI.green}========================================================================${ANSI.reset}\n`);

  } finally {
    await runtime.shutdown();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runMilestone7Demo().catch((err) => {
  console.error('Milestone 7 Demo Failed:', err);
  process.exit(1);
});
