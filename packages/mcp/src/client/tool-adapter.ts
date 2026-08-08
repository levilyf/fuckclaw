import { ToolDefinition, ToolResult, ToolContext } from '@fuckclaw/tool-runtime';
import { MCPTool, MCPServerConfig } from '../types.js';

export class MCPToolAdapter {
  public static toToolDefinition(
    mcpTool: MCPTool,
    serverConfig: MCPServerConfig,
    callFn: (toolName: string, args: Record<string, unknown>, context?: ToolContext) => Promise<ToolResult>
  ): ToolDefinition {
    const rawName = mcpTool.name;
    const resolvedName = serverConfig.toolPrefix
      ? `${serverConfig.toolPrefix}${rawName}`
      : rawName;

    return {
      name: resolvedName,
      description: `[MCP: ${serverConfig.name}] ${mcpTool.description || rawName}`,
      inputSchema: mcpTool.inputSchema || { type: 'object', properties: {} },
      source: {
        type: 'mcp' as const,
        pluginId: serverConfig.id,
      },
      execute: async (args: unknown, context?: ToolContext): Promise<ToolResult> => {
        return callFn(rawName, (args || {}) as Record<string, unknown>, context);
      },
    };
  }
}
