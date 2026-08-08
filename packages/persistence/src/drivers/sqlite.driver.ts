import Database from 'better-sqlite3';

export class SQLiteDriver {
  constructor(private db: Database.Database) {}

  execute(sql: string, params: unknown[] = []): void {
    this.db.prepare(sql).run(...params);
  }

  query<T>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  transaction<T>(fn: (db: Database.Database) => T): T {
    return this.db.transaction(() => fn(this.db))();
  }

  integrityCheck(): { ok: boolean; errors: string[] } {
    const result = this.db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    const errors: string[] = [];
    for (const row of result) {
      if (row.integrity_check !== 'ok') {
        errors.push(row.integrity_check);
      }
    }
    return {
      ok: errors.length === 0,
      errors,
    };
  }
}
