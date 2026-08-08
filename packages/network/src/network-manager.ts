import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { IAgentKernel } from '@fuckclaw/kernel';
import { IMemorySystem } from '@fuckclaw/memory';
import { IKnowledgeGraph } from '@fuckclaw/knowledge-graph';
import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { Scheduler } from '@fuckclaw/scheduler';
import { HttpServer } from './http/server.js';
import { WebSocketStreamServer } from './ws/ws-server.js';
import {
  INetworkManager,
  NetworkConfig,
  HttpMethod,
  RouteHandler,
} from './types.js';

export class NetworkManager implements INetworkManager {
  private httpServer: HttpServer;
  private wsServer?: WebSocketStreamServer;
  private activeConfig: NetworkConfig;
  private currentPort = 0;
  private currentHost = '127.0.0.1';

  constructor(
    kernel: IAgentKernel,
    eventBus: IEventBus,
    logger: IObservability,
    config: Partial<NetworkConfig> = {},
    memory?: IMemorySystem,
    knowledgeGraph?: IKnowledgeGraph,
    toolRuntime?: IToolRuntime,
    scheduler?: Scheduler
  ) {
    this.activeConfig = {
      host: config.host || '127.0.0.1',
      port: config.port !== undefined ? config.port : 8420,
      apiKey: config.apiKey,
      corsOrigins: config.corsOrigins || ['*'],
      enableWebSocket: config.enableWebSocket !== false,
    };

    this.httpServer = new HttpServer(
      kernel,
      this.activeConfig,
      logger,
      memory,
      knowledgeGraph,
      toolRuntime,
      scheduler
    );

    if (this.activeConfig.enableWebSocket) {
      this.wsServer = new WebSocketStreamServer(kernel, eventBus, this.activeConfig, logger);
    }
  }

  public async start(configOverrides?: Partial<NetworkConfig>): Promise<{ host: string; port: number }> {
    if (configOverrides) {
      Object.assign(this.activeConfig, configOverrides);
    }

    const { host, port } = await this.httpServer.start();
    this.currentHost = host;
    this.currentPort = port;

    const rawServer = this.httpServer.getRawServer();
    if (rawServer && this.wsServer) {
      this.wsServer.start(rawServer);
    }

    return { host, port };
  }

  public async stop(): Promise<void> {
    if (this.wsServer) {
      await this.wsServer.stop();
    }
    await this.httpServer.stop();
  }

  public registerRoute(method: HttpMethod, path: string, handler: RouteHandler): void {
    this.httpServer.registerRoute(method, path, handler);
  }

  public broadcast(topic: string, payload: unknown): void {
    if (this.wsServer) {
      this.wsServer.broadcast({
        type: 'event',
        source: topic,
        content: payload,
        timestamp: new Date().toISOString(),
      });
    }
  }

  public getPort(): number {
    return this.currentPort;
  }

  public getHost(): string {
    return this.currentHost;
  }
}
