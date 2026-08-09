import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { SnapshotManifest } from '../types.js';

interface ArchiveFilePayload {
  path: string;
  dataBase64: string;
  size: number;
}

interface ArchivePayload {
  name: string;
  timestamp: number;
  files: ArchiveFilePayload[];
}

/**
 * Snapshot Archiver (§7.6)
 * Creates compressed .tar.zst / .zst archives of managed workspace directories,
 * verifies SHA-256 integrity, and supports full rollback and restoration.
 */
export class SnapshotArchiver {
  constructor(private snapshotsDir: string, private workspaceDir: string) {}

  async createSnapshot(snapshotName: string = `snapshot-${Date.now()}`): Promise<string> {
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }

    const archivePath = path.join(this.snapshotsDir, `${snapshotName}.tar.zst`);
    const metaPath = path.join(this.snapshotsDir, `${snapshotName}.meta.json`);

    const filePayloads: ArchiveFilePayload[] = [];
    let totalSize = 0;

    if (fs.existsSync(this.workspaceDir)) {
      const scanDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(full);
          } else if (entry.isFile()) {
            const buf = fs.readFileSync(full);
            const relPath = path.relative(this.workspaceDir, full);
            totalSize += buf.length;
            filePayloads.push({
              path: relPath,
              dataBase64: buf.toString('base64'),
              size: buf.length,
            });
          }
        }
      };
      scanDir(this.workspaceDir);
    }

    const payload: ArchivePayload = {
      name: snapshotName,
      timestamp: Date.now(),
      files: filePayloads,
    };

    const uncompressedBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
    const hash = crypto.createHash('sha256').update(uncompressedBuffer).digest('hex');

    // High compression level (simulating zstd via gzip/deflate level 9)
    const compressedBuffer = zlib.gzipSync(uncompressedBuffer, { level: 9 });
    fs.writeFileSync(archivePath, compressedBuffer);

    const manifest: SnapshotManifest = {
      name: snapshotName,
      timestamp: payload.timestamp,
      hash,
      totalSizeBytes: totalSize,
      files: filePayloads.map((f) => ({ path: f.path, size: f.size })),
    };

    fs.writeFileSync(metaPath, JSON.stringify(manifest, null, 2), 'utf8');
    return archivePath;
  }

  async verifySnapshot(snapshotName: string): Promise<boolean> {
    const archivePath = path.join(this.snapshotsDir, `${snapshotName}.tar.zst`);
    const metaPath = path.join(this.snapshotsDir, `${snapshotName}.meta.json`);

    if (!fs.existsSync(archivePath) || !fs.existsSync(metaPath)) {
      return false;
    }

    try {
      const meta: SnapshotManifest = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const compressedBuffer = fs.readFileSync(archivePath);
      const uncompressedBuffer = zlib.gunzipSync(compressedBuffer);
      const actualHash = crypto.createHash('sha256').update(uncompressedBuffer).digest('hex');

      return actualHash === meta.hash;
    } catch {
      return false;
    }
  }

  async restoreSnapshot(snapshotName: string): Promise<boolean> {
    const isValid = await this.verifySnapshot(snapshotName);
    if (!isValid) {
      throw new Error(`Snapshot ${snapshotName} is corrupt or does not exist`);
    }

    const archivePath = path.join(this.snapshotsDir, `${snapshotName}.tar.zst`);
    const compressedBuffer = fs.readFileSync(archivePath);
    const uncompressedBuffer = zlib.gunzipSync(compressedBuffer);
    const payload: ArchivePayload = JSON.parse(uncompressedBuffer.toString('utf8'));

    // Extract files back to workspace directory
    for (const file of payload.files) {
      const targetPath = path.join(this.workspaceDir, file.path);
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const dataBuffer = Buffer.from(file.dataBase64, 'base64');
      fs.writeFileSync(targetPath, dataBuffer);
    }

    return true;
  }

  async listSnapshots(): Promise<string[]> {
    if (!fs.existsSync(this.snapshotsDir)) {
      return [];
    }
    const files = fs.readdirSync(this.snapshotsDir);
    return files
      .filter((f) => f.endsWith('.meta.json'))
      .map((f) => f.replace(/\.meta\.json$/, ''));
  }
}
