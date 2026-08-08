import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { ITool, ToolResult, ToolContext } from '../types.js';
import { ToolValidator } from './validator.js';
import { ErrorClassifier } from '../errors/error-classifier.js';

export class ExecutionPipeline {
  constructor(
    private logger: IObservability,
    private eventBus: IEventBus
  ) {}

  async execute(tool: ITool, rawParams: unknown, _context?: ToolContext): Promise<ToolResult> {
    const start = Date.now();
    await this.eventBus.emit('tool.execution.started', { toolName: tool.name, params: rawParams });

    try {
      const validatedParams = ToolValidator.validate(tool, rawParams);
      const result = await tool.execute(validatedParams);

      if (result.success) {
        await this.eventBus.emit('tool.execution.completed', {
          toolName: tool.name,
          executionTimeMs: result.executionTimeMs,
        });
        this.logger.getMetrics?.().incrementCounter('tools.executed');
      } else {
        await this.eventBus.emit('tool.execution.error', {
          toolName: tool.name,
          error: result.error,
          executionTimeMs: result.executionTimeMs,
        });
        this.logger.getMetrics?.().incrementCounter('tools.failed');
      }

      this.logger.log({
        level: result.success ? 'info' : 'warn',
        module: `tool.${tool.name}`,
        message: `Tool ${tool.name} finished in ${result.executionTimeMs}ms`,
        metadata: { toolName: tool.name, success: result.success },
      });

      return result;
    } catch (err: any) {
      const duration = Date.now() - start;
      const structuredError = ErrorClassifier.classify(err);
      const errorResult: ToolResult = {
        success: false,
        output: '',
        error: structuredError,
        executionTimeMs: duration,
      };

      await this.eventBus.emit('tool.execution.error', {
        toolName: tool.name,
        error: structuredError,
        executionTimeMs: duration,
      });
      this.logger.getMetrics?.().incrementCounter('tools.failed');

      return errorResult;
    }
  }
}
