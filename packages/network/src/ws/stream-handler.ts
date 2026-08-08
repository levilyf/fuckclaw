import { WebSocket } from 'ws';
import { WebSocketStreamMessage } from '../types.js';

export class StreamHandler {
  static send(client: WebSocket, message: WebSocketStreamMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  static broadcast(clients: Set<WebSocket>, message: WebSocketStreamMessage): void {
    const serialized = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }
}
