import Database from 'better-sqlite3';
import { IObservability } from '@fuckclaw/observability';
import { IPersistenceLayer } from './types.js';
import { ConnectionPool } from './connection/connection-pool.js';
import { MigrationRunner } from './migrations/migration-runner.js';
import { SQLiteDriver } from './drivers/sqlite.driver.js';
import { TaskRepository } from './repositories/task.repo.js';
import { EventRepository } from './repositories/event.repo.js';
import { MemoryRepository } from './repositories/memory.repo.js';
import { GraphRepository } from './repositories/graph.repo.js';
import { SnapshotManager } from './backup/snapshot-manager.js';

export class PersistenceLayer implements IPersistenceLayer {
  private pool: ConnectionPool;
  private driver: SQLiteDriver;
  private migrationRunner: MigrationRunner;
  public readonly tasks: TaskRepository;
  public readonly events: EventRepository;
  public readonly memories: MemoryRepository;
  public readonly graph: GraphRepository;
  public readonly snapshots: SnapshotManager;

  constructor(dbPath: string = ':memory:', logger?: IObservability) {
    this.pool = new ConnectionPool(dbPath);
    const db = this.pool.getMain();
    this.driver = new SQLiteDriver(db);
    this.migrationRunner = new MigrationRunner(db, logger);
    this.tasks = new TaskRepository(db);
    this.events = new EventRepository(db);
    this.memories = new MemoryRepository(db);
    this.graph = new GraphRepository(db);
    this.snapshots = new SnapshotManager(db);

    this.migrate();
  }

  public getRawDatabase(): Database.Database {
    return this.pool.getMain();
  }

  public migrate(): void {
    this.migrationRunner.run();
  }

  execute(sql: string, params: unknown[] = []): void {
    this.driver.execute(sql, params);
  }

  query<T>(sql: string, params: unknown[] = []): T[] {
    return this.driver.query<T>(sql, params);
  }

  transaction<T>(fn: (db: Database.Database) => T): T {
    return this.driver.transaction(fn);
  }

  integrityCheck(): { ok: boolean; errors: string[] } {
    return this.driver.integrityCheck();
  }

  close(): void {
    this.pool.close();
  }
}
