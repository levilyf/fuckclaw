import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);

export type ErrorCategory =
  | 'internal'
  | 'timeout'
  | 'permission'
  | 'not_found'
  | 'network'
  | 'user_cancelled';

export interface StructuredToolError {
  code: string;
  message: string;
  category: ErrorCategory;
  retryable: boolean;
  details?: unknown;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: StructuredToolError;
  executionTimeMs: number;
  metadata?: Record<string, unknown>;
}

export interface ITool {
  name: string;
  description: string;
  schema: z.ZodSchema;
  execute(params: unknown): Promise<ToolResult>;
}

export class ShellTool implements ITool {
  name = 'shell';
  description = 'Execute a shell command in the host environment';
  schema = z.object({
    command: z.string(),
    timeoutMs: z.number().default(60000),
    cwd: z.string().optional(),
  });

  async execute(params: unknown): Promise<ToolResult> {
    const parsed = this.schema.parse(params) as {
      command: string;
      timeoutMs: number;
      cwd?: string;
    };
    const start = Date.now();
    try {
      const { stdout, stderr } = await execAsync(parsed.command, {
        timeout: parsed.timeoutMs,
        cwd: parsed.cwd,
      });
      return {
        success: true,
        output: stdout || stderr,
        executionTimeMs: Date.now() - start,
        metadata: { stdout, stderr },
      };
    } catch (err: any) {
      const isTimeout = err.killed || /timeout/i.test(err.message || '');
      return {
        success: false,
        output: err.stdout || '',
        error: {
          code: isTimeout ? 'TIMEOUT' : 'EXEC_ERROR',
          message: err.message || String(err),
          category: isTimeout ? 'timeout' : 'internal',
          retryable: false,
          details: { stderr: err.stderr, code: err.code },
        },
        executionTimeMs: Date.now() - start,
      };
    }
  }
}

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
          // If file exists, replace content or append
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

export interface ToolContext {
  workingDirectory?: string;
  abortSignal?: AbortSignal;
  env?: Record<string, string>;
  taskId?: string;
}

export interface IToolRuntime {
  register(tool: ITool): void;
  get(name: string): ITool | undefined;
  list(): ITool[];
  has(name: string): boolean;
  execute(toolName: string, params: unknown, context?: ToolContext): Promise<ToolResult>;
}

export class ToolRuntime implements IToolRuntime {
  private tools: Map<string, ITool> = new Map();

  constructor(
    private logger: IObservability,
    private eventBus: IEventBus
  ) {}

  register(tool: ITool): void {
    this.tools.set(tool.name, tool);
    this.logger.log({
      level: 'debug',
      module: 'tool-runtime',
      message: `Tool registered: ${tool.name}`,
      metadata: { toolName: tool.name },
    });
  }

  getTool(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  listTools(): ITool[] {
    return Array.from(this.tools.values());
  }

  list(): ITool[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(toolName: string, params: unknown): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    const start = Date.now();

    if (!tool) {
      const errorResult: ToolResult = {
        success: false,
        output: '',
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Tool "${toolName}" is not registered in runtime`,
          category: 'not_found',
          retryable: false,
        },
        executionTimeMs: 0,
      };
      await this.eventBus.emit('tool.execution.error', { toolName, error: errorResult.error });
      return errorResult;
    }

    await this.eventBus.emit('tool.execution.started', { toolName, params });

    try {
      const result = await tool.execute(params);

      if (result.success) {
        await this.eventBus.emit('tool.execution.completed', {
          toolName,
          executionTimeMs: result.executionTimeMs,
        });
        this.logger.getMetrics?.().incrementCounter('tools.executed');
      } else {
        await this.eventBus.emit('tool.execution.error', {
          toolName,
          error: result.error,
          executionTimeMs: result.executionTimeMs,
        });
        this.logger.getMetrics?.().incrementCounter('tools.failed');
      }

      this.logger.log({
        level: result.success ? 'info' : 'warn',
        module: `tool.${toolName}`,
        message: `Tool ${toolName} finished in ${result.executionTimeMs}ms`,
        metadata: { toolName, success: result.success },
      });

      return result;
    } catch (err: any) {
      const duration = Date.now() - start;
      const errorResult: ToolResult = {
        success: false,
        output: '',
        error: {
          code: 'UNHANDLED_TOOL_ERROR',
          message: err.message || String(err),
          category: 'internal',
          retryable: false,
        },
        executionTimeMs: duration,
      };

      await this.eventBus.emit('tool.execution.error', {
        toolName,
        error: errorResult.error,
        executionTimeMs: duration,
      });
      this.logger.getMetrics?.().incrementCounter('tools.failed');

      return errorResult;
    }
  }
}
