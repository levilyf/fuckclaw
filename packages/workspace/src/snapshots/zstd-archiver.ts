import fs from 'node:fs';
import path from 'node:path';
import { SnapshotManifest } from '../types.js';

export class SnapshotArchiver {
  constructor(private snapshotsDir: string, private workspaceDir: string) {}

  async createSnapshot(snapshotName: string = `snapshot-${Date.now()}`): Promise<string> {
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }

    const snapshotPath = path.join(this.snapshotsDir, `${snapshotName}.json`);

    const manifest: SnapshotManifest = {
      name: snapshotName,
      timestamp: Date.now(),
      files: [],
    };

    if (fs.existsSync(this.workspaceDir)) {
      const scanDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(full);
          } else if (entry.isFile()) {
            const stat = fs.statSync(full);
            manifest.files.push({
              path: path.relative(this.workspaceDir, full),
              size: stat.size,
            });
          }
        }
      };
      scanDir(this.workspaceDir);
    }

    fs.writeFileSync(snapshotPath, JSON.stringify(manifest, null, 2), 'utf8');
    return snapshotPath;
  }

  async listSnapshots(): Promise<string[]> {
    if (!fs.existsSync(this.snapshotsDir)) {
      return [];
    }
    const files = fs.readdirSync(this.snapshotsDir);
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  }
}
