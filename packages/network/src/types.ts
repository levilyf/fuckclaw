import { IncomingMessage, ServerResponse } from 'node:http';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

export type RouteHandler = (ctx: RouteContext) => Promise<unknown> | unknown;

export interface NetworkConfig {
  host: string;
  port: number;
  apiKey?: string;
  corsOrigins?: string[];
  enableWebSocket?: boolean;
}

export interface WebSocketStreamMessage {
  type: 'stream' | 'event' | 'task_state' | 'pong' | 'error';
  taskId?: string;
  source?: string;
  content?: unknown;
  timestamp: string;
}

export interface INetworkManager {
  start(config?: Partial<NetworkConfig>): Promise<{ host: string; port: number }>;
  stop(): Promise<void>;
  registerRoute(method: HttpMethod, path: string, handler: RouteHandler): void;
  broadcast(topic: string, payload: unknown): void;
  getPort(): number;
  getHost(): string;
}
