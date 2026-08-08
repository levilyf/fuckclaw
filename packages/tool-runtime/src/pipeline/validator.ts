import { ITool } from '../types.js';

export class ToolValidator {
  static validate(tool: ITool, params: unknown): unknown {
    if (tool.schema) {
      return tool.schema.parse(params);
    }
    return params;
  }
}
