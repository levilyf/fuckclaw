import { z } from 'zod';
import { spawn } from 'node:child_process';
import { ITool, ToolResult } from '../types.js';

export const GitToolSchema = z.object({
  command: z.string().optional(),
  action: z.enum(['status', 'commit', 'diff', 'log', 'branch', 'checkout', 'clone', 'push', 'pull', 'add', 'reset', 'stash']).optional(),
  args: z.array(z.string()).default([]),
  message: z.string().optional(),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().default(60000),
});

export type GitToolParams = z.infer<typeof GitToolSchema>;

export class GitTool implements ITool {
  name = 'git';
  description = 'Execute Git operations (status, diff, log, commit, branch, checkout, clone, pull, push, stash) inside repositories.';
  schema = GitToolSchema;

  async execute(params: unknown): Promise<ToolResult> {
    const start = Date.now();
    let parsed: GitToolParams;
    try {
      parsed = this.schema.parse(params);
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: {
          code: 'INVALID_PARAMS',
          message: `Git tool parameter validation failed: ${err.message}`,
          category: 'internal',
          retryable: false,
        },
        executionTimeMs: Date.now() - start,
      };
    }

    let gitArgs: string[] = [];

    if (parsed.command) {
      const fullCmd = parsed.command.startsWith('git ') ? parsed.command.slice(4) : parsed.command;
      gitArgs = fullCmd.split(' ').filter(Boolean);
    } else if (parsed.action) {
      switch (parsed.action) {
        case 'commit':
          if (parsed.message) {
            gitArgs = ['commit', '-m', parsed.message, ...parsed.args];
          } else {
            gitArgs = ['commit', ...parsed.args];
          }
          break;
        default:
          gitArgs = [parsed.action, ...parsed.args];
          break;
      }
    } else {
      return {
        success: false,
        output: '',
        error: {
          code: 'MISSING_COMMAND',
          message: 'Git tool requires either a "command" string or an "action" parameter.',
          category: 'internal',
          retryable: false,
        },
        executionTimeMs: Date.now() - start,
      };
    }

    try {
      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
        const child = spawn('git', gitArgs, {
          cwd: parsed.cwd,
          env: process.env,
        });

        let stdout = '';
        let stderr = '';

        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          const timeoutErr = new Error(`Git command timed out after ${parsed.timeoutMs}ms`);
          (timeoutErr as any).code = 'TIMEOUT';
          reject(timeoutErr);
        }, parsed.timeoutMs);

        child.stdout?.on('data', (chunk) => {
          stdout += chunk.toString();
        });

        child.stderr?.on('data', (chunk) => {
          stderr += chunk.toString();
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode: code ?? 0 });
        });
      });

      const isSuccess = result.exitCode === 0;
      const output = result.stdout || result.stderr || (isSuccess ? 'Git operation completed successfully' : '');

      return {
        success: isSuccess,
        output,
        metadata: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          args: gitArgs,
        },
        error: !isSuccess
          ? {
              code: `GIT_EXIT_${result.exitCode}`,
              message: result.stderr || `Git command exited with code ${result.exitCode}`,
              category: 'internal',
              retryable: false,
              details: { exitCode: result.exitCode, stderr: result.stderr },
            }
          : undefined,
        executionTimeMs: Date.now() - start,
      };
    } catch (err: any) {
      const isTimeout = err.code === 'TIMEOUT' || /timed? ?out/i.test(err.message || '');
      const isNotFound = err.code === 'ENOENT';

      return {
        success: false,
        output: '',
        error: {
          code: isNotFound ? 'GIT_NOT_FOUND' : isTimeout ? 'TIMEOUT' : 'EXEC_ERROR',
          message: err.message || String(err),
          category: isNotFound ? 'not_found' : isTimeout ? 'timeout' : 'internal',
          retryable: false,
        },
        executionTimeMs: Date.now() - start,
      };
    }
  }
}
