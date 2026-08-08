import Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

export interface IPersistenceLayer {
  execute(sql: string, params?: unknown[]): void;
  query<T>(sql: string, params?: unknown[]): T[];
  transaction<T>(fn: (db: Database.Database) => T): T;
  migrate(): void;
  integrityCheck(): { ok: boolean; errors: string[] };
  close(): void;
}
