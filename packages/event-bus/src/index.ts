import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { ulid } from 'ulidx';

export enum EventPriority {
  CRITICAL = 0,
  HIGH = 10,
  NORMAL = 20,
  LOW = 30,
  DEBUG = 40,
}

export interface SystemEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  source?: string;
  correlationId?: string;
  causationId?: string;
  priority?: EventPriority | number;
  timestamp: string;
}

export interface EventQuery {
  type?: string;
  source?: string;
  correlationId?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
  limit?: number;
}

export interface DeadLetterEntry {
  event: SystemEvent;
  error: string;
  failedAt: number;
}

export type EventHandler = (event: SystemEvent) => Promise<void> | void;

export interface IEventBus {
  emit(
    type: string,
    payload: Record<string, unknown>,
    options?: {
      source?: string;
      correlationId?: string;
      causationId?: string;
      priority?: EventPriority | number;
    }
  ): Promise<string>;
  subscribe(pattern: string, handler: EventHandler): () => void;
  query(filter?: EventQuery): Promise<SystemEvent[]>;
  replay(fromTimestampOrId: string, handler: EventHandler): Promise<number>;
  getDLQ(): DeadLetterEntry[];
}

export class EventBus implements IEventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private dlq: DeadLetterEntry[] = [];

  constructor(
    private db: IPersistenceLayer,
    private logger: IObservability
  ) {}

  async emit(
    type: string,
    payload: Record<string, unknown>,
    options: {
      source?: string;
      correlationId?: string;
      causationId?: string;
      priority?: EventPriority | number;
    } = {}
  ): Promise<string> {
    const id = ulid();
    const event: SystemEvent = {
      id,
      timestamp: new Date().toISOString(),
      type,
      payload,
      source: options.source ?? 'system',
      correlationId: options.correlationId,
      causationId: options.causationId,
      priority: options.priority ?? EventPriority.NORMAL,
    };

    // 1. Persist to append-only SQLite log (§14.6)
    try {
      this.db.execute(
        `INSERT INTO events (id, type, payload, source, correlation_id, causation_id, priority, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id,
          event.type,
          JSON.stringify(event.payload),
          event.source,
          event.correlationId ?? null,
          event.causationId ?? null,
          event.priority,
          event.timestamp,
        ]
      );
    } catch (err) {
      this.logger.log({
        level: 'error',
        module: 'event-bus',
        message: 'Failed to persist event to SQLite',
        metadata: { error: String(err), eventId: event.id },
      });
    }

    this.logger.log({
      level: 'debug',
      module: 'event-bus',
      message: `Event emitted: ${type}`,
      metadata: { id: event.id, type: event.type, source: event.source },
    });

    // 2. Dispatch to matching subscribers
    const matchingHandlers = this.getMatchingHandlers(type);
    const dispatchPromises = matchingHandlers.map(async (handler) => {
      try {
        await handler(event);
      } catch (err) {
        const errorMsg = String(err);
        this.dlq.push({
          event,
          error: errorMsg,
          failedAt: Date.now(),
        });
        this.logger.log({
          level: 'error',
          module: 'event-bus',
          message: `Event handler failure on event "${type}"`,
          metadata: { error: errorMsg, eventId: event.id },
        });
      }
    });

    await Promise.allSettled(dispatchPromises);
    return id;
  }

  subscribe(pattern: string, handler: EventHandler): () => void {
    if (!this.handlers.has(pattern)) {
      this.handlers.set(pattern, new Set());
    }
    this.handlers.get(pattern)!.add(handler);

    return () => {
      this.handlers.get(pattern)?.delete(handler);
    };
  }

  async query(filter: EventQuery = {}): Promise<SystemEvent[]> {
    let sql = 'SELECT id, type, payload, source, correlation_id, causation_id, priority, timestamp FROM events WHERE 1=1';
    const params: unknown[] = [];

    if (filter.type) {
      if (filter.type.includes('*')) {
        sql += ' AND type LIKE ?';
        params.push(filter.type.replace(/\*/g, '%'));
      } else {
        sql += ' AND type = ?';
        params.push(filter.type);
      }
    }

    if (filter.source) {
      sql += ' AND source = ?';
      params.push(filter.source);
    }

    if (filter.correlationId) {
      sql += ' AND correlation_id = ?';
      params.push(filter.correlationId);
    }

    if (filter.fromTimestamp) {
      sql += ' AND timestamp >= ?';
      params.push(filter.fromTimestamp);
    }

    if (filter.toTimestamp) {
      sql += ' AND timestamp <= ?';
      params.push(filter.toTimestamp);
    }

    sql += ' ORDER BY timestamp ASC';

    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.query<{
      id: string;
      type: string;
      payload: string;
      source: string;
      correlation_id: string | null;
      causation_id: string | null;
      priority: number;
      timestamp: string;
    }>(sql, params);

    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      payload: JSON.parse(r.payload),
      source: r.source,
      correlationId: r.correlation_id ?? undefined,
      causationId: r.causation_id ?? undefined,
      priority: r.priority,
      timestamp: r.timestamp,
    }));
  }

  async replay(fromTimestampOrId: string, handler: EventHandler): Promise<number> {
    const isUlid = fromTimestampOrId.length === 26;
    let sql = 'SELECT id, type, payload, source, correlation_id, causation_id, priority, timestamp FROM events';
    const params: unknown[] = [];

    if (isUlid) {
      sql += ' WHERE id >= ? ORDER BY id ASC';
      params.push(fromTimestampOrId);
    } else {
      sql += ' WHERE timestamp >= ? ORDER BY timestamp ASC';
      params.push(fromTimestampOrId);
    }

    const rows = this.db.query<{
      id: string;
      type: string;
      payload: string;
      source: string;
      correlation_id: string | null;
      causation_id: string | null;
      priority: number;
      timestamp: string;
    }>(sql, params);

    let replayed = 0;
    for (const r of rows) {
      const event: SystemEvent = {
        id: r.id,
        type: r.type,
        payload: JSON.parse(r.payload),
        source: r.source,
        correlationId: r.correlation_id ?? undefined,
        causationId: r.causation_id ?? undefined,
        priority: r.priority,
        timestamp: r.timestamp,
      };
      await handler(event);
      replayed++;
    }

    return replayed;
  }

  getDLQ(): DeadLetterEntry[] {
    return [...this.dlq];
  }

  private getMatchingHandlers(eventType: string): EventHandler[] {
    const matched = new Set<EventHandler>();

    for (const [pattern, handlerSet] of this.handlers.entries()) {
      if (pattern === '*' || pattern === eventType) {
        handlerSet.forEach((h) => matched.add(h));
      } else if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        if (eventType === prefix || eventType.startsWith(prefix + '.')) {
          handlerSet.forEach((h) => matched.add(h));
        }
      } else if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(2);
        if (eventType === suffix || eventType.endsWith('.' + suffix)) {
          handlerSet.forEach((h) => matched.add(h));
        }
      }
    }

    return Array.from(matched);
  }
}
