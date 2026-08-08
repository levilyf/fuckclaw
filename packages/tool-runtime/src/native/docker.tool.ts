import { ITool, ToolResult } from '../types.js';

export class DockerTool implements ITool {
  name = 'docker';
  description = 'Deferred native Docker tool boundary defined by the Implementation Specification';

  async execute(): Promise<ToolResult> {
    return {
      success: false,
      output: '',
      error: {
        code: 'TOOL_NOT_IMPLEMENTED',
        message: 'Native Docker tool is structurally reserved but not implemented in the current milestone.',
        category: 'internal',
        retryable: false,
      },
      executionTimeMs: 0,
    };
  }
}
