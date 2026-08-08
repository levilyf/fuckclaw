import { ToolDefinition, ToolResult } from '@fuckclaw/tool-runtime';

export type MCPTransportType = 'stdio' | 'sse' | 'streamable_http' | 'in_memory';

export type MCPTransport =
  | { type: 'stdio'; command: string; args: string[] }
  | { type: 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'streamable_http'; url: string; headers?: Record<string, string> }
  | { type: 'in_memory'; handler: (request: JSONRPCRequest) => Promise<JSONRPCResponse> };

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransport;
  autoConnect: boolean;
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  toolPrefix?: string;
  env?: Record<string, string>;
}

export interface MCPServerStatus {
  config: MCPServerConfig;
  state: 'connected' | 'connecting' | 'disconnected' | 'error';
  toolCount: number;
  lastError?: string;
  connectedAt?: number;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
}

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface MCPServerTransportConfig {
  stdio?: boolean;
  http?: {
    port: number;
    path: string;
  };
}

export interface IMCPManager {
  connect(config: MCPServerConfig): Promise<void>;
  disconnect(serverId: string): Promise<void>;
  listServers(): MCPServerStatus[];
  listTools(serverId: string): ToolDefinition[];
  callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
  startServer(config?: MCPServerTransportConfig): Promise<void>;
  stopServer(): Promise<void>;
  handleJsonRpcMessage(message: JSONRPCRequest): Promise<JSONRPCResponse>;
}
