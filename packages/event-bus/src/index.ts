import { SystemEvent } from '@fuckclaw/core';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { ulid } from 'ulidx';

export type EventHandler = (event: SystemEvent) => Promise<void> | void;

export interface IEventBus {
  emit(type: string, payload: Record<string, unknown>): Promise<string>;
  subscribe(type: string, handler: EventHandler): () => void;
}

export class EventBus implements IEventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  constructor(
    private db: IPersistenceLayer,
    private logger: IObservability
  ) {}

  async emit(type: string, payload: Record<string, unknown>): Promise<string> {
    const id = ulid();
    const event: SystemEvent = {
      id,
      timestamp: new Date().toISOString(),
      type,
      payload
    };

    // Persist
    this.db.execute(
      'INSERT INTO events (id, timestamp, type, payload) VALUES (?, ?, ?, ?)',
      [event.id, event.timestamp, event.type, JSON.stringify(event.payload)]
    );

    this.logger.log({ level: 'debug', message: 'Event emitted', metadata: { type, id } });

    // Dispatch
    const typeHandlers = this.handlers.get(type) || new Set();
    const allHandlers = this.handlers.get('*') || new Set();
    
    const promises = Array.from(new Set([...typeHandlers, ...allHandlers])).map(async handler => {
      try {
        await handler(event);
      } catch (err) {
        this.logger.log({ level: 'error', message: 'Event handler error', metadata: { error: String(err) } });
      }
    });

    await Promise.allSettled(promises);
    return id;
  }

  subscribe(type: string, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }
}
