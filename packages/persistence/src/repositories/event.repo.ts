import Database from 'better-sqlite3';

export class EventRepository {
  constructor(private db: Database.Database) {}

  save(event: Record<string, unknown>): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (id, type, payload, source, correlation_id, causation_id, priority, timestamp)
      VALUES (@id, @type, @payload, @source, @correlation_id, @causation_id, @priority, @timestamp)
    `);
    stmt.run(event);
  }

  query(type?: string, limit: number = 100): Record<string, unknown>[] {
    if (type) {
      return this.db
        .prepare('SELECT * FROM events WHERE type = ? ORDER BY timestamp DESC LIMIT ?')
        .all(type, limit) as Record<string, unknown>[];
    }
    return this.db
      .prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
  }
}
