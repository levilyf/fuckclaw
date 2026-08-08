import { ITool, ToolResult } from '../types.js';

export class GitTool implements ITool {
  name = 'git';
  description = 'Deferred native Git tool boundary defined by the Implementation Specification';

  async execute(): Promise<ToolResult> {
    return {
      success: false,
      output: '',
      error: {
        code: 'TOOL_NOT_IMPLEMENTED',
        message: 'Native Git tool is structurally reserved but not implemented in the current milestone.',
        category: 'internal',
        retryable: false,
      },
      executionTimeMs: 0,
    };
  }
}
