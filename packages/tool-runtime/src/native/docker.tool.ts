import { z } from 'zod';
import { spawn } from 'node:child_process';
import { ITool, ToolResult } from '../types.js';

export const DockerToolSchema = z.object({
  command: z.string().optional(),
  action: z.enum(['run', 'ps', 'build', 'exec', 'stop', 'rm', 'images', 'logs', 'compose']).optional(),
  args: z.array(z.string()).default([]),
  image: z.string().optional(),
  container: z.string().optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeoutMs: z.number().int().positive().default(120000),
});

export type DockerToolParams = z.infer<typeof DockerToolSchema>;

export class DockerTool implements ITool {
  name = 'docker';
  description = 'Execute Docker container and image lifecycle operations (run, build, ps, logs, compose, stop, rm).';
  schema = DockerToolSchema;

  async execute(params: unknown): Promise<ToolResult> {
    const start = Date.now();
    let parsed: DockerToolParams;
    try {
      parsed = this.schema.parse(params);
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: {
          code: 'INVALID_PARAMS',
          message: `Docker tool parameter validation failed: ${err.message}`,
          category: 'internal',
          retryable: false,
        },
        executionTimeMs: Date.now() - start,
      };
    }

    let dockerArgs: string[] = [];

    if (parsed.command) {
      // Execute command string via docker CLI
      const fullCmd = parsed.command.startsWith('docker ') ? parsed.command.slice(7) : parsed.command;
      dockerArgs = fullCmd.split(' ').filter(Boolean);
    } else if (parsed.action) {
      switch (parsed.action) {
        case 'ps':
          dockerArgs = ['ps', ...parsed.args];
          break;
        case 'images':
          dockerArgs = ['images', ...parsed.args];
          break;
        case 'run':
          if (!parsed.image) {
            return {
              success: false,
              output: '',
              error: {
                code: 'MISSING_IMAGE',
                message: 'Docker "run" action requires an "image" parameter.',
                category: 'internal',
                retryable: false,
              },
              executionTimeMs: Date.now() - start,
            };
          }
          dockerArgs = ['run', '--rm', ...parsed.args, parsed.image];
          break;
        case 'build':
          dockerArgs = ['build', ...parsed.args, parsed.cwd || '.'];
          break;
        case 'logs':
          if (!parsed.container) {
            return {
              success: false,
              output: '',
              error: {
                code: 'MISSING_CONTAINER',
                message: 'Docker "logs" action requires a "container" parameter.',
                category: 'internal',
                retryable: false,
              },
              executionTimeMs: Date.now() - start,
            };
          }
          dockerArgs = ['logs', ...parsed.args, parsed.container];
          break;
        case 'stop':
          if (!parsed.container) {
            return {
              success: false,
              output: '',
              error: {
                code: 'MISSING_CONTAINER',
                message: 'Docker "stop" action requires a "container" parameter.',
                category: 'internal',
                retryable: false,
              },
              executionTimeMs: Date.now() - start,
            };
          }
          dockerArgs = ['stop', ...parsed.args, parsed.container];
          break;
        case 'compose':
          dockerArgs = ['compose', ...parsed.args];
          break;
        default:
          dockerArgs = [parsed.action, ...parsed.args];
          break;
      }
    } else {
      return {
        success: false,
        output: '',
        error: {
          code: 'MISSING_ACTION',
          message: 'Docker tool requires either a "command" string or an "action" parameter.',
          category: 'internal',
          retryable: false,
        },
        executionTimeMs: Date.now() - start,
      };
    }

    try {
      const env = {
        ...process.env,
        ...(parsed.env ?? {}),
      };

      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
        const child = spawn('docker', dockerArgs, {
          cwd: parsed.cwd,
          env,
        });

        let stdout = '';
        let stderr = '';

        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          const timeoutErr = new Error(`Docker command timed out after ${parsed.timeoutMs}ms`);
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
      const output = result.stdout || result.stderr || (isSuccess ? 'Docker command executed successfully' : '');

      return {
        success: isSuccess,
        output,
        metadata: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          args: dockerArgs,
        },
        error: !isSuccess
          ? {
              code: `DOCKER_EXIT_${result.exitCode}`,
              message: result.stderr || `Docker command exited with code ${result.exitCode}`,
              category: 'internal',
              retryable: false,
              details: { exitCode: result.exitCode, stderr: result.stderr },
            }
          : undefined,
        executionTimeMs: Date.now() - start,
      };
    } catch (err: any) {
      const isTimeout = err.code === 'TIMEOUT' || /timed? ?out/i.test(err.message || '');
      const isNotFound = err.code === 'ENOENT' || /docker: command not found|not found/i.test(err.message || '');

      return {
        success: false,
        output: '',
        error: {
          code: isNotFound ? 'DOCKER_NOT_FOUND' : isTimeout ? 'TIMEOUT' : 'EXEC_ERROR',
          message: err.message || String(err),
          category: isNotFound ? 'not_found' : isTimeout ? 'timeout' : 'internal',
          retryable: false,
        },
        executionTimeMs: Date.now() - start,
      };
    }
  }
}
