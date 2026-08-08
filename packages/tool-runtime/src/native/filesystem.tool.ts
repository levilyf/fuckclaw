import { z } from 'zod';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { ITool, ToolResult } from '../types.js';

export class FilesystemTool implements ITool {
  name = 'filesystem';
  description = 'Read, write, edit, delete, list, search, stat, check existence, and make directories';
  schema = z.object({
    action: z.enum(['read', 'write', 'edit', 'delete', 'list', 'search', 'exists', 'stat', 'mkdir']),
    path: z.string(),
    content: z.string().optional(),
    pattern: z.string().optional(),
    recursive: z.boolean().optional().default(false),
  });

  constructor(private workspace: IWorkspaceManager) {}

  async execute(params: unknown): Promise<ToolResult> {
    const parsed = this.schema.parse(params) as {
      action: 'read' | 'write' | 'edit' | 'delete' | 'list' | 'search' | 'exists' | 'stat' | 'mkdir';
      path: string;
      content?: string;
      pattern?: string;
      recursive?: boolean;
    };
    const start = Date.now();
    const targetPath = path.isAbsolute(parsed.path)
      ? parsed.path
      : path.join(this.workspace.getRoot(), parsed.path);

    try {
      switch (parsed.action) {
        case 'read': {
          const data = await fs.readFile(targetPath, 'utf8');
          return { success: true, output: data, executionTimeMs: Date.now() - start };
        }
        case 'write': {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, parsed.content ?? '', 'utf8');
          return { success: true, output: `Successfully wrote to ${parsed.path}`, executionTimeMs: Date.now() - start };
        }
        case 'edit': {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, parsed.content ?? '', 'utf8');
          return { success: true, output: `Successfully updated ${parsed.path}`, executionTimeMs: Date.now() - start };
        }
        case 'delete': {
          if (fsSync.existsSync(targetPath)) {
            const stat = await fs.stat(targetPath);
            if (stat.isDirectory()) {
              await fs.rm(targetPath, { recursive: true, force: true });
            } else {
              await fs.unlink(targetPath);
            }
            return { success: true, output: `Successfully deleted ${parsed.path}`, executionTimeMs: Date.now() - start };
          }
          return { success: true, output: `File ${parsed.path} already did not exist`, executionTimeMs: Date.now() - start };
        }
        case 'list': {
          const files = await fs.readdir(targetPath);
          return { success: true, output: files.join('\n'), executionTimeMs: Date.now() - start };
        }
        case 'exists': {
          const exists = fsSync.existsSync(targetPath);
          return { success: true, output: String(exists), executionTimeMs: Date.now() - start };
        }
        case 'stat': {
          const stat = await fs.stat(targetPath);
          return {
            success: true,
            output: JSON.stringify({
              size: stat.size,
              isFile: stat.isFile(),
              isDirectory: stat.isDirectory(),
              mtime: stat.mtimeMs,
            }),
            executionTimeMs: Date.now() - start,
          };
        }
        case 'mkdir': {
          await fs.mkdir(targetPath, { recursive: true });
          return { success: true, output: `Successfully created directory ${parsed.path}`, executionTimeMs: Date.now() - start };
        }
        case 'search': {
          const pattern = parsed.pattern ? new RegExp(parsed.pattern, 'i') : null;
          const matches: string[] = [];
          const scan = async (dir: string) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const e of entries) {
              const full = path.join(dir, e.name);
              if (e.isDirectory() && parsed.recursive) {
                await scan(full);
              } else if (pattern ? pattern.test(e.name) : true) {
                matches.push(path.relative(targetPath, full));
              }
            }
          };
          if (fsSync.existsSync(targetPath)) {
            await scan(targetPath);
          }
          return { success: true, output: matches.join('\n'), executionTimeMs: Date.now() - start };
        }
        default:
          throw new Error(`Unsupported action: ${parsed.action}`);
      }
    } catch (err: any) {
      const isNotFound = err.code === 'ENOENT';
      const isPerm = err.code === 'EACCES' || err.code === 'EPERM';
      return {
        success: false,
        output: '',
        error: {
          code: err.code || 'FS_ERROR',
          message: err.message || String(err),
          category: isNotFound ? 'not_found' : isPerm ? 'permission' : 'internal',
          retryable: false,
          details: { path: parsed.path },
        },
        executionTimeMs: Date.now() - start,
      };
    }
  }
}
