import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { LLMRouter } from '@fuckclaw/llm-router';
import { Task, ContextBundle, StepResult, IReasoningEngineRunner } from '@fuckclaw/kernel';
import { ReasoningEngineOptions, ReasoningStrategyType, IReasoningStrategy } from './types.js';
import { ReActLoop } from './react/react-loop.js';
import { DirectStrategy } from './strategies/direct-strategy.js';
import { TreeSearchStrategy } from './tree-search/tree-search-strategy.js';
import { StrategySelector } from './strategies/strategy-selector.js';

export class ReasoningEngine implements IReasoningEngineRunner {
  private strategies: Map<ReasoningStrategyType, IReasoningStrategy> = new Map();
  private defaultStrategy?: ReasoningStrategyType;

  constructor(
    private logger: IObservability,
    private eventBus: IEventBus,
    toolRuntime: IToolRuntime,
    llmRouter: LLMRouter,
    options: ReasoningEngineOptions = {}
  ) {
    this.defaultStrategy = options.defaultStrategy;

    const reactStrategy = new ReActLoop(logger, eventBus, toolRuntime, llmRouter, options.maxSteps ?? 10);
    const directStrategy = new DirectStrategy(logger, eventBus, toolRuntime, llmRouter);
    const treeSearchStrategy = new TreeSearchStrategy(logger, eventBus, toolRuntime, llmRouter);

    this.strategies.set('react', reactStrategy);
    this.strategies.set('direct', directStrategy);
    this.strategies.set('tree_search', treeSearchStrategy);
  }

  async runTask(
    task: Task,
    context: ContextBundle
  ): Promise<{ output: string; steps: StepResult[] }> {
    const selectedStrategyName = StrategySelector.select(task, context, this.defaultStrategy);
    const strategy = this.strategies.get(selectedStrategyName) ?? this.strategies.get('react')!;

    this.logger.log({
      level: 'info',
      module: 'reasoning',
      message: `Selected reasoning strategy "${selectedStrategyName}" for task ${task.id}`,
      metadata: { taskId: task.id, strategy: selectedStrategyName },
    });

    await this.eventBus.emit('reasoning.strategy.selected', {
      taskId: task.id,
      strategy: selectedStrategyName,
    });

    return strategy.execute(task, context);
  }
}

