import { IToolRuntime, ToolDefinition, ToolResult } from '@fuckclaw/tool-runtime';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { IKnowledgeGraph } from '@fuckclaw/knowledge-graph';
import { IObservability } from '@fuckclaw/observability';
import { MCPClientManager } from './client/mcp-client-manager.js';
import { MCPServer } from './server/mcp-server.js';
import {
  IMCPManager,
  MCPServerConfig,
  MCPServerStatus,
  MCPServerTransportConfig,
  JSONRPCRequest,
  JSONRPCResponse,
} from './types.js';

export class MCPManager implements IMCPManager {
  private clientManager: MCPClientManager;
  private server: MCPServer;

  constructor(
    toolRuntime: IToolRuntime,
    workspace?: IWorkspaceManager,
    knowledgeGraph?: IKnowledgeGraph,
    logger?: IObservability
  ) {
    this.clientManager = new MCPClientManager(toolRuntime, logger);
    this.server = new MCPServer(toolRuntime, workspace, knowledgeGraph, logger);
  }

  public async connect(config: MCPServerConfig): Promise<void> {
    return this.clientManager.connect(config);
  }

  public async disconnect(serverId: string): Promise<void> {
    return this.clientManager.disconnect(serverId);
  }

  public listServers(): MCPServerStatus[] {
    return this.clientManager.listServers();
  }

  public listTools(serverId: string): ToolDefinition[] {
    return this.clientManager.listTools(serverId);
  }

  public async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    return this.clientManager.callTool(serverId, toolName, args);
  }

  public async startServer(config?: MCPServerTransportConfig): Promise<void> {
    return this.server.start(config);
  }

  public async stopServer(): Promise<void> {
    return this.server.stop();
  }

  public async handleJsonRpcMessage(message: JSONRPCRequest): Promise<JSONRPCResponse> {
    return this.server.handleRequest(message);
  }

  public async shutdown(): Promise<void> {
    await this.clientManager.disconnectAll();
    await this.server.stop();
  }
}
