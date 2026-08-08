import { IObservability } from '@fuckclaw/observability';
import { ITool } from '../types.js';

export class ToolRegistry {
  private tools: Map<string, ITool> = new Map();

  constructor(private logger?: IObservability) {}

  register(tool: ITool): void {
    if (!tool.source) {
      tool.source = { type: 'native' };
    }
    this.tools.set(tool.name, tool);
    this.logger?.log({
      level: 'debug',
      module: 'tool-runtime',
      message: `Tool registered: ${tool.name}`,
      metadata: { toolName: tool.name },
    });
  }

  unregister(name: string): boolean {
    const deleted = this.tools.delete(name);
    if (deleted) {
      this.logger?.log({
        level: 'debug',
        module: 'tool-runtime',
        message: `Tool unregistered: ${name}`,
        metadata: { toolName: name },
      });
    }
    return deleted;
  }

  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  list(): ITool[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
