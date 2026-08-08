import { IConfigManager } from '@fuckclaw/config';
import { IObservability } from '@fuckclaw/observability';
import path from 'node:path';
import os from 'node:os';
import { IWorkspaceManager } from './types.js';
import { DirectoryManager } from './layout/directory-manager.js';
import { ProjectRegistry } from './projects/project-registry.js';
import { ArtifactStore } from './artifacts/artifact-store.js';
import { SnapshotArchiver } from './snapshots/zstd-archiver.js';

export class WorkspaceManager implements IWorkspaceManager {
  private root: string;
  public readonly projects: ProjectRegistry;
  public readonly artifacts: ArtifactStore;
  public readonly snapshots: SnapshotArchiver;

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

    this.projects = new ProjectRegistry(this.resolvePath('data', 'projects'));
    this.artifacts = new ArtifactStore(this.resolvePath('workspace', 'artifacts'));
    this.snapshots = new SnapshotArchiver(this.resolvePath('snapshots'), this.resolvePath('workspace'));
  }

  async init(): Promise<void> {
    DirectoryManager.ensureLayout(this.root);

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

  getDirectory(category: string): string {
    return DirectoryManager.resolvePath(this.root, category);
  }

  resolvePath(category: string, ...subPaths: string[]): string {
    return DirectoryManager.resolvePath(this.root, category, ...subPaths);
  }

  isInsideWorkspace(targetPath: string): boolean {
    return DirectoryManager.isInside(this.root, targetPath);
  }

  assertSafePath(targetPath: string): string {
    return DirectoryManager.assertSafe(this.root, targetPath);
  }

  async createSnapshot(snapshotName?: string): Promise<string> {
    const snapshotPath = await this.snapshots.createSnapshot(snapshotName);
    this.logger.log({
      level: 'info',
      module: 'workspace',
      message: `Workspace snapshot created: ${snapshotName || 'default'}`,
      metadata: { snapshotPath },
    });
    return snapshotPath;
  }

  async listSnapshots(): Promise<string[]> {
    return this.snapshots.listSnapshots();
  }
}
