import { IObservability } from '@fuckclaw/observability';
import { IToolRuntime, ToolDefinition, ToolResult } from '@fuckclaw/tool-runtime';
import { MCPServerConfig, MCPServerStatus } from '../types.js';
import { MCPClientConnection } from './mcp-client.js';
import { MCPToolAdapter } from './tool-adapter.js';

export class MCPClientManager {
  private connections = new Map<string, MCPClientConnection>();
  private registeredToolNamesByServer = new Map<string, string[]>();
  private serverStatuses = new Map<string, MCPServerStatus>();

  constructor(
    private toolRuntime: IToolRuntime,
    private logger?: IObservability
  ) {}

  public async connect(config: MCPServerConfig): Promise<void> {
    const status: MCPServerStatus = {
      config,
      state: 'connecting',
      toolCount: 0,
    };
    this.serverStatuses.set(config.id, status);

    const client = new MCPClientConnection(config, this.logger);
    try {
      await client.connect();
      this.connections.set(config.id, client);

      status.state = 'connected';
      status.connectedAt = Date.now();
      status.toolCount = client.tools.length;
      delete status.lastError;

      // Adapt and register discovered tools in ToolRuntime
      const toolNames: string[] = [];
      for (const mcpTool of client.tools) {
        const toolDef = MCPToolAdapter.toToolDefinition(
          mcpTool,
          config,
          async (toolName, args, context) => client.callTool(toolName, args, context)
        );

        this.toolRuntime.register(toolDef);
        toolNames.push(toolDef.name);
      }
      this.registeredToolNamesByServer.set(config.id, toolNames);

      this.logger?.info?.(`Connected to MCP server "${config.name}" (${config.id}) with ${toolNames.length} tool(s) registered`, {
        serverId: config.id,
        tools: toolNames,
      });
    } catch (err: unknown) {
      status.state = 'error';
      status.lastError = (err as Error).message;
      this.logger?.error?.(`Failed to connect to MCP server "${config.name}" (${config.id}): ${(err as Error).message}`);
      throw err;
    }
  }

  public async disconnect(serverId: string): Promise<void> {
    const client = this.connections.get(serverId);
    if (client) {
      await client.disconnect();
      this.connections.delete(serverId);
    }

    const toolNames = this.registeredToolNamesByServer.get(serverId) || [];
    for (const toolName of toolNames) {
      this.toolRuntime.unregister(toolName);
    }
    this.registeredToolNamesByServer.delete(serverId);

    const status = this.serverStatuses.get(serverId);
    if (status) {
      status.state = 'disconnected';
      status.toolCount = 0;
    }

    this.logger?.info?.(`Disconnected from MCP server (${serverId}) and removed ${toolNames.length} tool(s)`);
  }

  public listServers(): MCPServerStatus[] {
    return Array.from(this.serverStatuses.values());
  }

  public listTools(serverId: string): ToolDefinition[] {
    const toolNames = this.registeredToolNamesByServer.get(serverId) || [];
    return toolNames
      .map((name) => this.toolRuntime.get(name))
      .filter((t): t is ToolDefinition => t !== undefined);
  }

  public async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const client = this.connections.get(serverId);
    if (!client) {
      throw new Error(`MCP server "${serverId}" is not connected`);
    }
    return client.callTool(toolName, args);
  }

  public async disconnectAll(): Promise<void> {
    for (const serverId of Array.from(this.connections.keys())) {
      await this.disconnect(serverId);
    }
  }
}
