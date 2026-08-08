import { z } from 'zod';

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
  schema?: z.ZodSchema;
  inputSchema?: Record<string, unknown>;
  source?: { type: 'native' | 'mcp' | 'plugin'; pluginId?: string };
  execute(params: unknown): Promise<ToolResult>;
}

export type ToolDefinition = ITool;

export interface ToolContext {
  workingDirectory?: string;
  abortSignal?: AbortSignal;
  env?: Record<string, string>;
  taskId?: string;
}

export interface IToolRuntime {
  register(tool: ITool): void;
  unregister(name: string): boolean;
  get(name: string): ITool | undefined;
  list(): ITool[];
  has(name: string): boolean;
  execute(toolName: string, params: unknown, context?: ToolContext): Promise<ToolResult>;
}
