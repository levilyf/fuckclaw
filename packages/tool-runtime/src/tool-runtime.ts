import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { ITool, ToolResult, ToolContext, IToolRuntime } from './types.js';
import { ToolRegistry } from './registry/tool-registry.js';
import { ExecutionPipeline } from './pipeline/execution-pipeline.js';

export class ToolRuntime implements IToolRuntime {
  private registry: ToolRegistry;
  private pipeline: ExecutionPipeline;

  constructor(
    logger: IObservability,
    private eventBus: IEventBus
  ) {
    this.registry = new ToolRegistry(logger);
    this.pipeline = new ExecutionPipeline(logger, eventBus);
  }

  register(tool: ITool): void {
    this.registry.register(tool);
  }

  unregister(name: string): boolean {
    return this.registry.unregister(name);
  }

  getTool(name: string): ITool | undefined {
    return this.registry.get(name);
  }

  get(name: string): ITool | undefined {
    return this.registry.get(name);
  }

  listTools(): ITool[] {
    return this.registry.list();
  }

  list(): ITool[] {
    return this.registry.list();
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  async execute(toolName: string, params: unknown, context?: ToolContext): Promise<ToolResult> {
    const tool = this.registry.get(toolName);

    if (!tool) {
      const errorResult: ToolResult = {
        success: false,
        output: '',
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Tool "${toolName}" is not registered in runtime`,
          category: 'not_found',
          retryable: false,
        },
        executionTimeMs: 0,
      };
      await this.eventBus.emit('tool.execution.error', { toolName, error: errorResult.error });
      return errorResult;
    }

    return this.pipeline.execute(tool, params, context);
  }
}
