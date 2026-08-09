export interface IWorkspaceManager {
  init(): Promise<void>;
  getRoot(): string;
  getDirectory(category: string): string;
  resolvePath(category: string, ...subPaths: string[]): string;
  isInsideWorkspace(targetPath: string): boolean;
  assertSafePath(targetPath: string): string;
  createSnapshot(snapshotName?: string): Promise<string>;
  listSnapshots(): Promise<string[]>;
  rollbackToSnapshot(snapshotName: string): Promise<boolean>;
  verifySnapshot(snapshotName: string): Promise<boolean>;
}

export interface ProjectMetadata {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface SnapshotFileEntry {
  path: string;
  size: number;
}

export interface SnapshotManifest {
  name: string;
  timestamp: number;
  hash: string;
  totalSizeBytes: number;
  files: SnapshotFileEntry[];
}
