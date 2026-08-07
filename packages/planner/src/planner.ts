import { IAgentKernel } from '@fuckclaw/kernel';
import { LLMRouter } from '@fuckclaw/llm-router';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import {
  TaskPlan,
  PlanExecutionResult,
  ReplanPolicy,
} from './types.js';
import { GoalDecomposer, GoalDecompositionOptions } from './decomposition/goal-decomposer.js';
import { DynamicReplanner } from './replanning/dynamic-replanner.js';
import { PlanExecutor } from './execution/plan-executor.js';

export interface PlannerOptions {
  replanPolicy?: Partial<ReplanPolicy>;
}

export class Planner {
  private decomposer: GoalDecomposer;
  private replanner: DynamicReplanner;
  private executor: PlanExecutor;

  constructor(
    kernel: IAgentKernel,
    logger: IObservability,
    eventBus: IEventBus,
    llmRouter?: LLMRouter,
    persistence?: IPersistenceLayer,
    options: PlannerOptions = {}
  ) {
    this.decomposer = new GoalDecomposer(logger, llmRouter);
    this.replanner = new DynamicReplanner(logger, llmRouter, options.replanPolicy);
    this.executor = new PlanExecutor(kernel, logger, eventBus, this.replanner, persistence);
  }

  /**
   * Decomposes a high-level goal into an executable TaskPlan with a validated DAG.
   */
  async plan(
    goal: string,
    contextSummary: string = '',
    options: GoalDecompositionOptions = {}
  ): Promise<TaskPlan> {
    return this.decomposer.decompose(goal, contextSummary, options);
  }

  /**
   * Executes a TaskPlan systematically through the Kernel, handling failures via dynamic replanning.
   */
  async executePlan(plan: TaskPlan): Promise<PlanExecutionResult> {
    return this.executor.executePlan(plan);
  }

  /**
   * High-level convenience method: Decomposes a goal into a DAG plan and executes it to completion.
   */
  async executeGoal(
    goal: string,
    contextSummary: string = '',
    options: GoalDecompositionOptions = {}
  ): Promise<PlanExecutionResult> {
    const plan = await this.plan(goal, contextSummary, options);
    return this.executePlan(plan);
  }

  /**
   * Manually triggers replanning for an existing plan when a step fails.
   */
  async replan(
    plan: TaskPlan,
    failedStepId: string,
    errorMessage: string
  ): Promise<TaskPlan> {
    return this.replanner.replan(plan, failedStepId, errorMessage);
  }
}
