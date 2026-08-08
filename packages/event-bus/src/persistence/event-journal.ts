import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { SystemEvent, EventQuery, EventHandler } from '../types.js';

export class EventJournal {
  constructor(
    private db: IPersistenceLayer,
    private logger?: IObservability
  ) {}

  persist(event: SystemEvent): void {
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
      this.logger?.log({
        level: 'error',
        module: 'event-bus',
        message: 'Failed to persist event to SQLite',
        metadata: { error: String(err), eventId: event.id },
      });
    }
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
}
