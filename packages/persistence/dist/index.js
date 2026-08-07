import Database from 'better-sqlite3';
export class PersistenceLayer {
    logger;
    db;
    constructor(dbPath = ':memory:', logger) {
        this.logger = logger;
        this.db = new Database(dbPath);
        this.init();
    }
    init() {
        this.db.pragma('journal_mode = WAL');
        this.migrate();
    }
    migrate() {
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
    execute(sql, params = []) {
        this.db.prepare(sql).run(...params);
    }
    query(sql, params = []) {
        return this.db.prepare(sql).all(...params);
    }
    close() {
        this.db.close();
        this.logger?.log({ level: 'debug', message: 'Database closed' });
    }
}
//# sourceMappingURL=index.js.map