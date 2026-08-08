import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'node:http';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus, SystemEvent } from '@fuckclaw/event-bus';
import { AgentKernel } from '@fuckclaw/kernel';
import { WebSocketStreamMessage, NetworkConfig } from '../types.js';

export class WebSocketStreamServer {
  private wss?: WebSocketServer;
  private unsubscribeBus?: () => void;
  private clients = new Set<WebSocket>();

  constructor(
    private kernel: AgentKernel,
    private eventBus: IEventBus,
    public readonly config: NetworkConfig,
    private logger?: IObservability
  ) {}

  public start(httpServer: Server): void {
    this.wss = new WebSocketServer({ server: httpServer });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      this.logger?.debug?.('WebSocket client connected');

      // Send initial connection greeting
      this.sendToClient(ws, {
        type: 'event',
        source: 'system',
        content: { message: 'Connected to FuckClaw Realtime Gateway', state: this.kernel.getState() },
        timestamp: new Date().toISOString(),
      });

      ws.on('message', async (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString('utf8')) as {
            type: string;
            prompt?: string;
            taskId?: string;
          };

          if (parsed.type === 'ping') {
            this.sendToClient(ws, {
              type: 'pong',
              timestamp: new Date().toISOString(),
            });
            return;
          }

          if (parsed.type === 'submit_task' && parsed.prompt) {
            const task = await this.kernel.submitTask({
              description: parsed.prompt,
              source: { type: 'user' },
            });
            this.sendToClient(ws, {
              type: 'task_state',
              taskId: task.id,
              content: { taskId: task.id, state: task.state },
              timestamp: new Date().toISOString(),
            });
            return;
          }

          if (parsed.type === 'cancel_task' && parsed.taskId) {
            await this.kernel.cancelTask(parsed.taskId);
            this.sendToClient(ws, {
              type: 'task_state',
              taskId: parsed.taskId,
              content: { taskId: parsed.taskId, state: 'cancelled' },
              timestamp: new Date().toISOString(),
            });
            return;
          }
        } catch (err: unknown) {
          this.sendToClient(ws, {
            type: 'error',
            content: (err as Error).message,
            timestamp: new Date().toISOString(),
          });
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.logger?.debug?.('WebSocket client disconnected');
      });

      ws.on('error', (err) => {
        this.logger?.warn?.(`WebSocket client error: ${err.message}`);
        this.clients.delete(ws);
      });
    });

    // Subscribe to EventBus to broadcast live tool executions, reasoning traces, and task state changes
    this.unsubscribeBus = this.eventBus.subscribe('*', async (event: SystemEvent) => {
      let msgType: WebSocketStreamMessage['type'] = 'event';
      if (event.type.startsWith('tool.')) {
        msgType = 'stream';
      } else if (event.type.startsWith('task.')) {
        msgType = 'task_state';
      }

      this.broadcast({
        type: msgType,
        source: event.type,
        content: event.payload,
        timestamp: event.timestamp || new Date().toISOString(),
      });
    });
  }

  public broadcast(message: WebSocketStreamMessage): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch {
          // Client buffer full or disconnected
        }
      }
    }
  }

  private sendToClient(client: WebSocket, message: WebSocketStreamMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  public async stop(): Promise<void> {
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = undefined;
    }

    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        // Ignore
      }
    }
    this.clients.clear();

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
