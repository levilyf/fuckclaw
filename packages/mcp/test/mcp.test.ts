import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MCPManager } from '../src/mcp-manager.js';
import { MCPServerConfig, JSONRPCRequest, JSONRPCResponse } from '../src/types.js';
import { ToolRuntime, IToolRuntime, ToolDefinition, FilesystemTool, ShellTool } from '@fuckclaw/tool-runtime';
import { WorkspaceManager, IWorkspaceManager } from '@fuckclaw/workspace';
import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('MCP Subsystem (@fuckclaw/mcp)', () => {
  let toolRuntime: IToolRuntime;
  let workspace: IWorkspaceManager;
  let mcpManager: MCPManager;
  let db: PersistenceLayer;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `.fuckclaw-mcp-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const config = new ConfigManager({ workspace: { root: tempDir } } as any);
    workspace = new WorkspaceManager(config);

    const logger = new Logger(config);
    db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);

    toolRuntime = new ToolRuntime(logger, bus);
    toolRuntime.register(new FilesystemTool(workspace));
    toolRuntime.register(new ShellTool());

    mcpManager = new MCPManager(toolRuntime, workspace, undefined, logger);
  });

  afterEach(async () => {
    await mcpManager.shutdown();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('MCP Server Exposure', () => {
    it('handles initialize handshake', async () => {
      const req: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'claude-desktop', version: '1.0.0' },
        },
      };

      const res = await mcpManager.handleJsonRpcMessage(req);
      expect(res.jsonrpc).toBe('2.0');
      expect(res.id).toBe(1);
      expect(res.result).toBeDefined();
      const serverInfo = (res.result as { serverInfo: { name: string; version: string } }).serverInfo;
      expect(serverInfo.name).toBe('fuckclaw');
    });

    it('lists native FuckClaw tools as MCP tools with fc_ prefix', async () => {
      const req: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      };

      const res = await mcpManager.handleJsonRpcMessage(req);
      expect(res.result).toBeDefined();
      const tools = (res.result as { tools: Array<{ name: string; description: string }> }).tools;
      expect(tools.length).toBeGreaterThanOrEqual(2);
      expect(tools.some((t) => t.name === 'fc_filesystem')).toBe(true);
      expect(tools.some((t) => t.name === 'fc_shell')).toBe(true);
    });

    it('executes native tool through tools/call', async () => {
      const req: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'fc_filesystem',
          arguments: {
            action: 'write',
            path: 'workspace/mcp_test.txt',
            content: 'Hello MCP Server!',
          },
        },
      };

      const res = await mcpManager.handleJsonRpcMessage(req);
      expect(res.result).toBeDefined();
      const resultObj = res.result as { content: Array<{ type: string; text: string }>; isError: boolean };
      expect(resultObj.isError).toBe(false);
      expect(resultObj.content[0].text).toContain('Successfully wrote');

      const fullPath = path.join(tempDir, 'workspace', 'mcp_test.txt');
      expect(fs.readFileSync(fullPath, 'utf8')).toBe('Hello MCP Server!');
    });

    it('lists and reads workspace resources', async () => {
      const listReq: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/list',
      };

      const listRes = await mcpManager.handleJsonRpcMessage(listReq);
      const resources = (listRes.result as { resources: Array<{ uri: string }> }).resources;
      expect(resources.some((r) => r.uri === 'fuckclaw://workspace/root')).toBe(true);

      const readReq: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 5,
        method: 'resources/read',
        params: { uri: 'fuckclaw://workspace/root' },
      };
      const readRes = await mcpManager.handleJsonRpcMessage(readReq);
      const contents = (readRes.result as { contents: Array<{ uri: string; text: string }> }).contents;
      expect(contents[0].text).toBe(tempDir);
    });
  });

  describe('MCP Client Integration', () => {
    it('connects to an in-memory MCP server and registers tools in ToolRuntime', async () => {
      // Mock external server implementing JSON-RPC 2.0
      const mockExternalServer = async (req: JSONRPCRequest): Promise<JSONRPCResponse> => {
        if (req.method === 'initialize') {
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'github-server', version: '2.1.0' },
              capabilities: { tools: {} },
            },
          };
        }
        if (req.method === 'tools/list') {
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              tools: [
                {
                  name: 'create_issue',
                  description: 'Create a GitHub issue',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      body: { type: 'string' },
                    },
                    required: ['title'],
                  },
                },
              ],
            },
          };
        }
        if (req.method === 'tools/call') {
          const params = req.params as { name: string; arguments: { title: string } };
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Issue created: "${params.arguments?.title}" (#42)`,
                },
              ],
              isError: false,
            },
          };
        }
        return { jsonrpc: '2.0', id: req.id, result: {} };
      };

      const serverConfig: MCPServerConfig = {
        id: 'github_ext',
        name: 'GitHub MCP Server',
        transport: {
          type: 'in_memory',
          handler: mockExternalServer,
        },
        autoConnect: true,
        autoReconnect: false,
        maxReconnectAttempts: 1,
        toolPrefix: 'gh_',
      };

      await mcpManager.connect(serverConfig);

      const servers = mcpManager.listServers();
      expect(servers.length).toBe(1);
      expect(servers[0].state).toBe('connected');
      expect(servers[0].toolCount).toBe(1);

      // Verify tool was registered in ToolRuntime
      expect(toolRuntime.has('gh_create_issue')).toBe(true);
      const toolDef = toolRuntime.get('gh_create_issue') as ToolDefinition;
      expect(toolDef.name).toBe('gh_create_issue');
      expect(toolDef.source?.type).toBe('mcp');

      // Execute tool through normal ToolRuntime path
      const execResult = await toolRuntime.execute('gh_create_issue', {
        title: 'Bug report: memory leak',
      });

      expect(execResult.success).toBe(true);
      expect(execResult.output).toBe('Issue created: "Bug report: memory leak" (#42)');

      // Disconnect and verify tool is removed
      await mcpManager.disconnect('github_ext');
      expect(toolRuntime.has('gh_create_issue')).toBe(false);
      expect(mcpManager.listServers()[0].state).toBe('disconnected');
    });
  });
});
