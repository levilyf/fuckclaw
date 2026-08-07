import { IConfigManager } from '@fuckclaw/config';
import { IObservability } from '@fuckclaw/observability';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface IWorkspaceManager {
  init(): Promise<void>;
  getRoot(): string;
  resolvePath(category: string, ...subPaths: string[]): string;
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
      'snapshots'
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
      message: 'Workspace directory layout verified',
      metadata: { root: this.root }
    });
  }

  getRoot(): string {
    return this.root;
  }

  resolvePath(category: string, ...subPaths: string[]): string {
    return path.join(this.root, category, ...subPaths);
  }
}
