import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export class SnapshotManager {
  constructor(private db: Database.Database) {}

  async backup(destinationPath: string): Promise<void> {
    const parentDir = path.dirname(destinationPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    await this.db.backup(destinationPath);
  }
}
