import fs from 'node:fs';
import path from 'node:path';

export class DirectoryManager {
  static readonly CANONICAL_DIRS = [
    'config',
    'data',
    'workspace',
    'logs',
    'cache',
    'plugins',
    'skills',
    'snapshots',
  ];

  static ensureLayout(rootPath: string): void {
    if (!fs.existsSync(rootPath)) {
      fs.mkdirSync(rootPath, { recursive: true });
    }

    for (const dir of this.CANONICAL_DIRS) {
      const fullPath = path.join(rootPath, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }
  }

  static resolvePath(rootPath: string, category: string, ...subPaths: string[]): string {
    return path.join(rootPath, category, ...subPaths);
  }

  static isInside(rootPath: string, targetPath: string): boolean {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedRoot = path.resolve(rootPath);
    return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
  }

  static assertSafe(rootPath: string, targetPath: string): string {
    return path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(rootPath, targetPath);
  }
}
