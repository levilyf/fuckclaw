import { ITool, ToolResult } from '../types.js';

export class HttpTool implements ITool {
  name = 'http';
  description = 'Deferred native HTTP tool boundary defined by the Implementation Specification';

  async execute(): Promise<ToolResult> {
    return {
      success: false,
      output: '',
      error: {
        code: 'TOOL_NOT_IMPLEMENTED',
        message: 'Native HTTP tool is structurally reserved but not implemented in the current milestone.',
        category: 'internal',
        retryable: false,
      },
      executionTimeMs: 0,
    };
  }
}
