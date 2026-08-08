import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { applyStandardPragmas } from './pragmas.js';

export class ConnectionPool {
  private mainDb: Database.Database;

  constructor(dbPath: string = ':memory:') {
    if (dbPath !== ':memory:') {
      const parentDir = path.dirname(dbPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
    }
    this.mainDb = new Database(dbPath, { timeout: 5000 });
    applyStandardPragmas(this.mainDb);
  }

  getMain(): Database.Database {
    return this.mainDb;
  }

  close(): void {
    this.mainDb.close();
  }
}
