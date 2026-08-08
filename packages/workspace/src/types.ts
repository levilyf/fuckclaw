export interface IWorkspaceManager {
  init(): Promise<void>;
  getRoot(): string;
  getDirectory(category: string): string;
  resolvePath(category: string, ...subPaths: string[]): string;
  isInsideWorkspace(targetPath: string): boolean;
  assertSafePath(targetPath: string): string;
  createSnapshot(snapshotName?: string): Promise<string>;
  listSnapshots(): Promise<string[]>;
}

export interface ProjectMetadata {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface SnapshotManifest {
  name: string;
  timestamp: number;
  files: Array<{ path: string; size: number }>;
}
