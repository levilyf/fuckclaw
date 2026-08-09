import { z } from 'zod';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ITool, ToolResult, StructuredToolError } from '../types.js';

export const PythonToolSchema = z.object({
  script: z.string().optional(),
  file: z.string().optional(),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeoutMs: z.number().int().positive().default(60000),
});

export type PythonToolParams = z.infer<typeof PythonToolSchema>;

export class PythonTool implements ITool {
  name = 'python';
  description = 'Execute Python scripts or script files through host python3 runtime, capturing stdout, stderr, and exit codes.';
  schema = PythonToolSchema;

  async execute(params: unknown): Promise<ToolResult> {
    const start = Date.now();
    let parsed: PythonToolParams;
    try {
      parsed = this.schema.parse(params);
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: {
          code: 'INVALID_PARAMS',
          message: `Python tool parameter validation failed: ${err.message}`,
          category: 'internal',
          retryable: false,
        },
        executionTimeMs: Date.now() - start,
      };
    }

    if (!parsed.script && !parsed.file) {
      return {
        success: false,
        output: '',
        error: {
          code: 'MISSING_SCRIPT',
          message: 'Python tool requires either a "script" string or a "file" path parameter.',
          category: 'internal',
          retryable: false,
        },
        executionTimeMs: Date.now() - start,
      };
    }

    let tempFile: string | null = null;
    let targetFilePath = parsed.file;

    try {
      if (parsed.script) {
        tempFile = path.join(os.tmpdir(), `fuckclaw-py-${Date.now()}-${Math.random().toString(36).slice(2)}.py`);
        fs.writeFileSync(tempFile, parsed.script, 'utf8');
        targetFilePath = tempFile;
      }

      // Check python command availability (python3 vs python)
      const pythonCmd = 'python3';
      const cmdArgs = [targetFilePath!, ...parsed.args];

      const env = {
        ...process.env,
        ...(parsed.env ?? {}),
      };

      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
        const child = spawn(pythonCmd, cmdArgs, {
          cwd: parsed.cwd,
          env,
        });

        let stdout = '';
        let stderr = '';

        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          const timeoutErr = new Error(`Python execution timed out after ${parsed.timeoutMs}ms`);
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
      const combinedOutput = result.stdout || result.stderr || (isSuccess ? 'Python execution finished with exit code 0' : '');

      return {
        success: isSuccess,
        output: combinedOutput,
        metadata: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        },
        error: !isSuccess
          ? {
              code: `EXIT_${result.exitCode}`,
              message: result.stderr || `Python process exited with code ${result.exitCode}`,
              category: 'internal',
              retryable: false,
              details: { exitCode: result.exitCode, stderr: result.stderr },
            }
          : undefined,
        executionTimeMs: Date.now() - start,
      };
    } catch (err: any) {
      const isTimeout = err.code === 'TIMEOUT' || /timed? ?out/i.test(err.message || '');
      const structuredError: StructuredToolError = {
        code: isTimeout ? 'TIMEOUT' : 'EXEC_ERROR',
        message: err.message || String(err),
        category: isTimeout ? 'timeout' : 'internal',
        retryable: false,
      };

      return {
        success: false,
        output: '',
        error: structuredError,
        executionTimeMs: Date.now() - start,
      };
    } finally {
      if (tempFile && fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {}
      }
    }
  }
}
