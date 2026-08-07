import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execAsync = promisify(exec);

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  executionTimeMs: number;
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
    timeoutMs: z.number().default(30000)
  });

  async execute(params: unknown): Promise<ToolResult> {
    const parsed = this.schema.parse(params) as { command: string; timeoutMs: number };
    const start = Date.now();
    try {
      const { stdout, stderr } = await execAsync(parsed.command, { timeout: parsed.timeoutMs });
      return {
        success: true,
        output: stdout || stderr,
        executionTimeMs: Date.now() - start
      };
    } catch (err: any) {
      return {
        success: false,
        output: err.stdout || '',
        error: err.message || String(err),
        executionTimeMs: Date.now() - start
      };
    }
  }
}

export class FilesystemTool implements ITool {
  name = 'filesystem';
  description = 'Read or write files inside the workspace';
  schema = z.object({
    action: z.enum(['read', 'write', 'list']),
    path: z.string(),
    content: z.string().optional()
  });

  constructor(private workspace: IWorkspaceManager) {}

  async execute(params: unknown): Promise<ToolResult> {
    const parsed = this.schema.parse(params) as { action: 'read' | 'write' | 'list'; path: string; content?: string };
    const start = Date.now();
    const targetPath = path.isAbsolute(parsed.path) 
      ? parsed.path 
      : path.join(this.workspace.getRoot(), parsed.path);

    try {
      if (parsed.action === 'read') {
        const data = await fs.readFile(targetPath, 'utf8');
        return { success: true, output: data, executionTimeMs: Date.now() - start };
      } else if (parsed.action === 'write') {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, parsed.content ?? '', 'utf8');
        return { success: true, output: `Successfully wrote to ${parsed.path}`, executionTimeMs: Date.now() - start };
      } else if (parsed.action === 'list') {
        const files = await fs.readdir(targetPath);
        return { success: true, output: files.join('\n'), executionTimeMs: Date.now() - start };
      }
      throw new Error(`Unsupported action: ${parsed.action}`);
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: err.message || String(err),
        executionTimeMs: Date.now() - start
      };
    }
  }
}

export class ToolRuntime {
  private tools: Map<string, ITool> = new Map();

  constructor(
    private logger: IObservability,
    private eventBus: IEventBus
  ) {}

  register(tool: ITool): void {
    this.tools.set(tool.name, tool);
    this.logger.log({ level: 'debug', message: 'Tool registered', metadata: { toolName: tool.name } });
  }

  getTool(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  async execute(toolName: string, params: unknown): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    const start = Date.now();

    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Tool not found: ${toolName}`,
        executionTimeMs: 0
      };
    }

    try {
      tool.schema.parse(params);
    } catch (validationError: any) {
      this.logger.log({ level: 'warn', message: 'Tool parameter validation failed', metadata: { toolName, error: validationError.message } });
      return {
        success: false,
        output: '',
        error: `Validation error: ${validationError.message}`,
        executionTimeMs: Date.now() - start
      };
    }

    await this.eventBus.emit('tool.execution.started', { toolName });
    const result = await tool.execute(params);
    await this.eventBus.emit('tool.execution.completed', { toolName, success: result.success });

    this.logger.log({
      level: result.success ? 'info' : 'error',
      message: `Tool ${toolName} finished in ${result.executionTimeMs}ms`,
      metadata: { toolName, success: result.success }
    });

    return result;
  }
}
