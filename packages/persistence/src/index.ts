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

    // Milestone 4: Memory system schemas
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodic_memories (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        task_id TEXT,
        timestamp INTEGER NOT NULL,
        source TEXT NOT NULL,
        actor TEXT NOT NULL,
        summary TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_call_json TEXT,
        importance_score REAL NOT NULL DEFAULT 0.5,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at INTEGER NOT NULL,
        consolidated INTEGER NOT NULL DEFAULT 0,
        decay_factor REAL NOT NULL DEFAULT 1.0,
        embedding_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_episodic_time ON episodic_memories(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_episodic_session ON episodic_memories(session_id);
      CREATE INDEX IF NOT EXISTS idx_episodic_task ON episodic_memories(task_id);
      CREATE INDEX IF NOT EXISTS idx_episodic_consolidated ON episodic_memories(consolidated, timestamp);
    `);

    // FTS5 indexes for full-text search
    // These use IF NOT EXISTS via a try/catch since FTS5 virtual tables
    // don't support IF NOT EXISTS syntax directly in all SQLite builds.
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE episodic_fts USING fts5(
          id UNINDEXED,
          summary,
          content,
          tokenize = 'porter unicode61'
        );
      `);
    } catch {
      // Table already exists
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_memories (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        statement TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        source_episodic_ids_json TEXT,
        valid_from INTEGER NOT NULL,
        valid_until INTEGER,
        superseded_by TEXT,
        context_json TEXT,
        last_verified_at INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        embedding_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_semantic_spo ON semantic_memories(subject, predicate);
      CREATE INDEX IF NOT EXISTS idx_semantic_validity ON semantic_memories(valid_until);
    `);

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE semantic_fts USING fts5(
          id UNINDEXED,
          statement,
          subject,
          object,
          tokenize = 'porter unicode61'
        );
      `);
    } catch {
      // Table already exists
    }

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
