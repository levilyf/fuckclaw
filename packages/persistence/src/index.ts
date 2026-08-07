import Database from 'better-sqlite3';
import { IObservability } from '@fuckclaw/observability';

export interface IPersistenceLayer {
  execute(sql: string, params?: unknown[]): void;
  query<T>(sql: string, params?: unknown[]): T[];
  close(): void;
}

export class PersistenceLayer implements IPersistenceLayer {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:', private logger?: IObservability) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);
    this.logger?.log({ level: 'debug', message: 'Database schema migrated' });
  }

  execute(sql: string, params: unknown[] = []): void {
    this.db.prepare(sql).run(...params);
  }

  query<T>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  close(): void {
    this.db.close();
    this.logger?.log({ level: 'debug', message: 'Database closed' });
  }
}
