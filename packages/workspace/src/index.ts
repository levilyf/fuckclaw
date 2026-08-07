import { IConfigManager } from '@fuckclaw/config';
import { IObservability } from '@fuckclaw/observability';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface IWorkspaceManager {
  init(): Promise<void>;
  getRoot(): string;
  resolvePath(category: string, ...subPaths: string[]): string;
  isInsideWorkspace(targetPath: string): boolean;
  assertSafePath(targetPath: string): string;
  createSnapshot(snapshotName?: string): Promise<string>;
  listSnapshots(): Promise<string[]>;
}

export class WorkspaceManager implements IWorkspaceManager {
  private root: string;

  constructor(
    private config: IConfigManager,
    private logger: IObservability
  ) {
    const rawRoot = this.config.get().workspace.root;
    if (rawRoot.startsWith('~/')) {
      this.root = path.join(os.homedir(), rawRoot.slice(2));
    } else {
      this.root = path.resolve(rawRoot);
    }
  }

  async init(): Promise<void> {
    const canonicalDirs = [
      'config',
      'data',
      'workspace',
      'logs',
      'cache',
      'plugins',
      'skills',
      'snapshots',
    ];

    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true });
    }

    for (const dir of canonicalDirs) {
      const fullPath = path.join(this.root, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    this.logger.log({
      level: 'debug',
      module: 'workspace',
      message: 'Workspace directory layout verified',
      metadata: { root: this.root },
    });
  }

  getRoot(): string {
    return this.root;
  }

  resolvePath(category: string, ...subPaths: string[]): string {
    return path.join(this.root, category, ...subPaths);
  }

  isInsideWorkspace(targetPath: string): boolean {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedRoot = path.resolve(this.root);
    return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
  }

  assertSafePath(targetPath: string): string {
    const resolved = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(this.root, targetPath);

    return resolved;
  }

  async createSnapshot(snapshotName: string = `snapshot-${Date.now()}`): Promise<string> {
    const snapshotsDir = this.resolvePath('snapshots');
    if (!fs.existsSync(snapshotsDir)) {
      fs.mkdirSync(snapshotsDir, { recursive: true });
    }

    const snapshotPath = path.join(snapshotsDir, `${snapshotName}.json`);
    const workspaceUserDir = this.resolvePath('workspace');

    const manifest: { name: string; timestamp: number; files: Array<{ path: string; size: number }> } = {
      name: snapshotName,
      timestamp: Date.now(),
      files: [],
    };

    if (fs.existsSync(workspaceUserDir)) {
      const scanDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(full);
          } else if (entry.isFile()) {
            const stat = fs.statSync(full);
            manifest.files.push({
              path: path.relative(workspaceUserDir, full),
              size: stat.size,
            });
          }
        }
      };
      scanDir(workspaceUserDir);
    }

    fs.writeFileSync(snapshotPath, JSON.stringify(manifest, null, 2), 'utf8');

    this.logger.log({
      level: 'info',
      module: 'workspace',
      message: `Workspace snapshot created: ${snapshotName}`,
      metadata: { snapshotPath, fileCount: manifest.files.length },
    });

    return snapshotPath;
  }

  async listSnapshots(): Promise<string[]> {
    const snapshotsDir = this.resolvePath('snapshots');
    if (!fs.existsSync(snapshotsDir)) {
      return [];
    }
    const files = fs.readdirSync(snapshotsDir);
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  }
}
