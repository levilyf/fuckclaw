import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { LLMRouter } from '@fuckclaw/llm-router';
import { Task, ContextBundle, StepResult, IReasoningEngineRunner } from '@fuckclaw/kernel';
import { ReasoningEngineOptions } from './types.js';
import { ReActLoop } from './react/react-loop.js';

export class ReasoningEngine implements IReasoningEngineRunner {
  private reactLoop: ReActLoop;

  constructor(
    logger: IObservability,
    eventBus: IEventBus,
    toolRuntime: IToolRuntime,
    llmRouter: LLMRouter,
    options: ReasoningEngineOptions = {}
  ) {
    this.reactLoop = new ReActLoop(logger, eventBus, toolRuntime, llmRouter, options.maxSteps ?? 10);
  }

  async runTask(
    task: Task,
    context: ContextBundle
  ): Promise<{ output: string; steps: StepResult[] }> {
    return this.reactLoop.execute(task, context);
  }
}
