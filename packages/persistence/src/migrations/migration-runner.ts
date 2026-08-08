import Database from 'better-sqlite3';
import { IObservability } from '@fuckclaw/observability';
import { Migration } from '../types.js';
import { standardMigrations } from './scripts/index.js';

export class MigrationRunner {
  constructor(private db: Database.Database, private logger?: IObservability) {}

  run(migrations: Migration[] = standardMigrations): void {
    // 1. Ensure migrations table exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    const appliedRows = this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
    const appliedVersions = new Set<number>(appliedRows.map((r) => r.version));

    for (const migration of migrations) {
      if (!appliedVersions.has(migration.version)) {
        this.logger?.log({
          level: 'debug',
          module: 'persistence',
          message: `Applying migration v${migration.version}: ${migration.name}`,
        });

        this.db.transaction(() => {
          migration.up(this.db);
          this.db
            .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
            .run(migration.version, migration.name, Date.now());
        })();
      }
    }
  }
}
