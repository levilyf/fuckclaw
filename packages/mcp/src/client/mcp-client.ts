import { spawn, ChildProcess } from 'node:child_process';
import { IObservability } from '@fuckclaw/observability';
import { ToolResult, ToolContext } from '@fuckclaw/tool-runtime';
import {
  MCPServerConfig,
  MCPTool,
  MCPResource,
  MCPPrompt,
  JSONRPCRequest,
  JSONRPCResponse,
} from '../types.js';

export class MCPClientConnection {
  private childProcess?: ChildProcess;
  private requestId = 0;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (res: JSONRPCResponse) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private buffer = '';
  public tools: MCPTool[] = [];
  public resources: MCPResource[] = [];
  public prompts: MCPPrompt[] = [];
  public isConnected = false;

  constructor(
    public readonly config: MCPServerConfig,
    private logger?: IObservability
  ) {}

  public async connect(): Promise<void> {
    if (this.config.transport.type === 'in_memory') {
      this.isConnected = true;
      await this.initializeHandshake();
      await this.refreshCapabilities();
      return;
    }

    if (this.config.transport.type === 'stdio') {
      const { command, args } = this.config.transport;
      const env = { ...process.env, ...(this.config.env || {}) };

      this.childProcess = spawn(command, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.childProcess.stdout?.on('data', (data: Buffer) => {
        this.handleData(data.toString('utf8'));
      });

      this.childProcess.stderr?.on('data', (data: Buffer) => {
        this.logger?.warn?.(`MCP Server [${this.config.id}] stderr: ${data.toString('utf8').trim()}`);
      });

      this.childProcess.on('error', (err) => {
        this.logger?.error?.(`MCP Server [${this.config.id}] process error: ${err.message}`);
        this.isConnected = false;
      });

      this.childProcess.on('exit', (code, signal) => {
        this.logger?.warn?.(`MCP Server [${this.config.id}] exited with code ${code}, signal ${signal}`);
        this.isConnected = false;
      });

      this.isConnected = true;
      await this.initializeHandshake();
      await this.refreshCapabilities();
      return;
    }

    if (this.config.transport.type === 'sse' || this.config.transport.type === 'streamable_http') {
      this.isConnected = true;
      await this.initializeHandshake();
      await this.refreshCapabilities();
      return;
    }

    throw new Error(`Unsupported transport type: ${(this.config.transport as { type: string }).type}`);
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JSONRPCResponse;
        if (msg.id !== undefined && msg.id !== null && this.pendingRequests.has(msg.id)) {
          const entry = this.pendingRequests.get(msg.id)!;
          clearTimeout(entry.timer);
          this.pendingRequests.delete(msg.id);
          entry.resolve(msg);
        }
      } catch {
        // Non-JSON stdout or partial frame
      }
    }
  }

  public async sendRequest(method: string, params?: Record<string, unknown>): Promise<JSONRPCResponse> {
    const id = ++this.requestId;
    const req: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    if (this.config.transport.type === 'in_memory') {
      return this.config.transport.handler(req);
    }

    if (this.config.transport.type === 'stdio') {
      if (!this.childProcess || !this.childProcess.stdin?.writable) {
        throw new Error(`MCP server [${this.config.id}] stdio is not writable`);
      }

      return new Promise<JSONRPCResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout for method "${method}" (server: ${this.config.id})`));
        }, 15000);

        this.pendingRequests.set(id, { resolve, reject, timer });
        this.childProcess!.stdin!.write(JSON.stringify(req) + '\n');
      });
    }

    if (this.config.transport.type === 'sse' || this.config.transport.type === 'streamable_http') {
      const url = this.config.transport.url;
      const headers = {
        'Content-Type': 'application/json',
        ...(this.config.transport.headers || {}),
      };

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
      });

      if (!res.ok) {
        throw new Error(`HTTP MCP request failed with status ${res.status}: ${res.statusText}`);
      }

      return (await res.json()) as JSONRPCResponse;
    }

    throw new Error(`Cannot send request: unsupported transport`);
  }

  private async initializeHandshake(): Promise<void> {
    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: true },
        sampling: {},
      },
      clientInfo: {
        name: 'fuckclaw',
        version: '1.0.0',
      },
    });

    if (response.error) {
      throw new Error(`MCP initialize handshake failed: ${response.error.message}`);
    }

    // Send initialized notification
    if (this.config.transport.type === 'stdio' && this.childProcess?.stdin?.writable) {
      const notif: JSONRPCRequest = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      };
      this.childProcess.stdin.write(JSON.stringify(notif) + '\n');
    }
  }

  public async refreshCapabilities(): Promise<void> {
    // 1. Discover tools
    try {
      const toolsRes = await this.sendRequest('tools/list');
      if (!toolsRes.error && toolsRes.result) {
        const resObj = toolsRes.result as { tools?: MCPTool[] };
        this.tools = resObj.tools || [];
      }
    } catch (err: unknown) {
      this.logger?.warn?.(`Failed to list tools from MCP server [${this.config.id}]: ${(err as Error).message}`);
    }

    // 2. Discover resources
    try {
      const resRes = await this.sendRequest('resources/list');
      if (!resRes.error && resRes.result) {
        const resObj = resRes.result as { resources?: MCPResource[] };
        this.resources = resObj.resources || [];
      }
    } catch {
      // Optional capability
    }

    // 3. Discover prompts
    try {
      const promptRes = await this.sendRequest('prompts/list');
      if (!promptRes.error && promptRes.result) {
        const resObj = promptRes.result as { prompts?: MCPPrompt[] };
        this.prompts = resObj.prompts || [];
      }
    } catch {
      // Optional capability
    }
  }

  public async callTool(toolName: string, args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const response = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args,
      });

      const executionTimeMs = Date.now() - startTime;

      if (response.error) {
        return {
          success: false,
          output: `MCP Tool Error: ${response.error.message}`,
          error: {
            code: `MCP_${response.error.code}`,
            message: response.error.message,
            category: 'internal',
            retryable: false,
          },
          executionTimeMs,
          metadata: { durationMs: executionTimeMs },
        };
      }

      const result = response.result as {
        content?: Array<{ type: string; text?: string; resource?: unknown }>;
        isError?: boolean;
      };

      const isError = Boolean(result?.isError);
      const textOutput = result?.content
        ?.filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('\n') || JSON.stringify(result ?? {});

      return {
        success: !isError,
        output: textOutput,
        error: isError
          ? {
              code: 'MCP_TOOL_EXECUTION_FAILED',
              message: textOutput,
              category: 'internal',
              retryable: true,
            }
          : undefined,
        executionTimeMs,
        metadata: { durationMs: executionTimeMs },
      };
    } catch (err: unknown) {
      const executionTimeMs = Date.now() - startTime;
      const errorMsg = (err as Error).message;
      return {
        success: false,
        output: `MCP Execution Exception: ${errorMsg}`,
        error: {
          code: 'MCP_CALL_FAILED',
          message: errorMsg,
          category: 'internal',
          retryable: true,
        },
        executionTimeMs,
        metadata: { durationMs: executionTimeMs },
      };
    }
  }

  public async disconnect(): Promise<void> {
    this.isConnected = false;
    for (const [id, entry] of this.pendingRequests.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`MCP server [${this.config.id}] disconnected`));
      this.pendingRequests.delete(id);
    }

    if (this.childProcess) {
      try {
        this.childProcess.kill('SIGTERM');
      } catch {
        // Process might already be dead
      }
      this.childProcess = undefined;
    }
  }
}
