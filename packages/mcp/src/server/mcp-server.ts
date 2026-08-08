import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { IKnowledgeGraph } from '@fuckclaw/knowledge-graph';
import { IObservability } from '@fuckclaw/observability';
import { ResourceExposer } from './resource-exposer.js';
import {
  JSONRPCRequest,
  JSONRPCResponse,
  MCPTool,
  MCPPrompt,
  MCPServerTransportConfig,
} from '../types.js';

export class MCPServer {
  private resourceExposer: ResourceExposer;
  public isRunning = false;
  public transportConfig?: MCPServerTransportConfig;

  constructor(
    private toolRuntime: IToolRuntime,
    workspace?: IWorkspaceManager,
    knowledgeGraph?: IKnowledgeGraph,
    private logger?: IObservability
  ) {
    this.resourceExposer = new ResourceExposer(workspace, knowledgeGraph);
  }

  public async start(config: MCPServerTransportConfig = { stdio: true }): Promise<void> {
    this.isRunning = true;
    this.transportConfig = config;
    this.logger?.info?.('FuckClaw MCP Server started', { transport: config });
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    this.logger?.info?.('FuckClaw MCP Server stopped');
  }

  public async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    const { id, method, params } = request;

    try {
      switch (method) {
        case 'initialize': {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: {
                name: 'fuckclaw',
                version: '1.0.0',
              },
              capabilities: {
                tools: { listChanged: true },
                resources: { subscribe: false, listChanged: true },
                prompts: { listChanged: true },
              },
            },
          };
        }

        case 'notifications/initialized': {
          return { jsonrpc: '2.0', id, result: {} };
        }

        case 'ping': {
          return { jsonrpc: '2.0', id, result: {} };
        }

        case 'tools/list': {
          const tools = this.toolRuntime
            .list()
            .filter((t) => !t.source || t.source.type === 'native')
            .map(
              (t): MCPTool => ({
                name: `fc_${t.name}`,
                description: t.description,
                inputSchema: (t.inputSchema || { type: 'object', properties: {} }) as MCPTool['inputSchema'],
              })
            );

          return { jsonrpc: '2.0', id, result: { tools } };
        }

        case 'tools/call': {
          const toolParams = params as { name: string; arguments?: Record<string, unknown> };
          if (!toolParams || !toolParams.name) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: 'Missing tool name in tools/call request' },
            };
          }

          let targetTool = toolParams.name;
          if (targetTool.startsWith('fc_')) {
            targetTool = targetTool.slice(3);
          }

          const execResult = await this.toolRuntime.execute(targetTool, toolParams.arguments || {});
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: execResult.output,
                },
              ],
              isError: !execResult.success,
            },
          };
        }

        case 'resources/list': {
          const resources = await this.resourceExposer.listResources();
          return { jsonrpc: '2.0', id, result: { resources } };
        }

        case 'resources/read': {
          const resourceParams = params as { uri: string };
          if (!resourceParams?.uri) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: 'Missing uri in resources/read' },
            };
          }
          const content = await this.resourceExposer.readResource(resourceParams.uri);
          return { jsonrpc: '2.0', id, result: { contents: [content] } };
        }

        case 'prompts/list': {
          const prompts: MCPPrompt[] = [
            {
              name: 'memory_search',
              description: 'Search FuckClaw memory for relevant context and verified facts',
              arguments: [
                { name: 'query', description: 'Semantic search query for persistent memory', required: true },
              ],
            },
          ];
          return { jsonrpc: '2.0', id, result: { prompts } };
        }

        case 'prompts/get': {
          const promptParams = params as { name: string; arguments?: Record<string, string> };
          if (promptParams?.name === 'memory_search') {
            const query = promptParams.arguments?.query || '';
            return {
              jsonrpc: '2.0',
              id,
              result: {
                description: 'Search FuckClaw memory for relevant context and verified facts',
                messages: [
                  {
                    role: 'user',
                    content: {
                      type: 'text',
                      text: `Retrieve verified memory records, prior task episodes, and semantic facts regarding: "${query}". Base your answer strictly on verified memories without speculation.`,
                    },
                  },
                ],
              },
            };
          }
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Unknown prompt: ${promptParams?.name}` },
          };
        }

        default: {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          };
        }
      }
    } catch (err: unknown) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: (err as Error).message || 'Internal MCP Server Error',
        },
      };
    }
  }
}
