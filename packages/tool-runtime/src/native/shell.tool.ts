import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ITool, ToolResult } from '../types.js';

const execAsync = promisify(exec);

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
