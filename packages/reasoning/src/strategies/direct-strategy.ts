import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { LLMRouter, ChatMessage } from '@fuckclaw/llm-router';
import { Task, ContextBundle, StepResult } from '@fuckclaw/kernel';
import { IReasoningStrategy, ReasoningStrategyType } from '../types.js';
import { ToolCallParser } from '../parsers/tool-call-parser.js';

export class DirectStrategy implements IReasoningStrategy {
  readonly name: ReasoningStrategyType = 'direct';

  constructor(
    private logger: IObservability,
    private eventBus: IEventBus,
    private toolRuntime: IToolRuntime,
    private llmRouter: LLMRouter
  ) {}

  async execute(task: Task, context: ContextBundle): Promise<{ output: string; steps: StepResult[] }> {
    this.logger.log({
      level: 'info',
      module: 'reasoning.direct',
      message: `Executing Direct reasoning strategy for task ${task.id}: "${task.description}"`,
      metadata: { taskId: task.id },
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: context.systemPrompt },
      { role: 'user', content: task.description },
    ];

    const response = await this.llmRouter.generate({
      messages,
      taskId: task.id,
      temperature: 0.1,
    });

    const parsed = ToolCallParser.parse(response.content);
    const steps: StepResult[] = [];

    let finalOutput = response.content;

    if (parsed.toolName) {
      let toolSuccess = true;
      let observation = '';

      try {
        const result = await this.toolRuntime.execute(
          parsed.toolName,
          parsed.toolArgs ?? {},
          { taskId: task.id }
        );
        toolSuccess = result.success;
        observation = result.output || (result.error ? result.error.message : '');
      } catch (err: any) {
        toolSuccess = false;
        observation = err.message || String(err);
      }

      steps.push({
        step: 1,
        thought: parsed.thought ?? response.content,
        action: `${parsed.toolName}(${JSON.stringify(parsed.toolArgs ?? {})})`,
        observation,
        success: toolSuccess,
      });

      finalOutput = observation;
    } else {
      steps.push({
        step: 1,
        thought: response.content,
        action: 'direct_response',
        observation: response.content,
        success: true,
      });
      finalOutput = parsed.finalResponse ?? response.content;
    }

    await this.eventBus.emit('reasoning.direct.completed', {
      taskId: task.id,
      output: finalOutput,
    });

    return {
      output: finalOutput,
      steps,
    };
  }
}
