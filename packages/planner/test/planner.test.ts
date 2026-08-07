import { describe, it, expect, vi } from 'vitest';
import {
  DAGBuilder,
  GoalDecomposer,
  DynamicReplanner,
  Planner,
  TaskPlan,
  PlanStep,
  Dependency,
} from '../src/index.js';
import { AgentKernel, TaskState, Task } from '@fuckclaw/kernel';
import { EventBus } from '@fuckclaw/event-bus';
import { Logger } from '@fuckclaw/observability';
import { ConfigManager } from '@fuckclaw/config';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { WorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime } from '@fuckclaw/tool-runtime';
import { LLMRouter } from '@fuckclaw/llm-router';

function createMockInfrastructure() {
  const config = new ConfigManager({
    workspace: { root: ':memory:' },
    logging: { level: 'error' },
  });
  const logger = new Logger(config);
  const db = new PersistenceLayer(':memory:', logger);
  const bus = new EventBus(db, logger);
  const workspace = new WorkspaceManager(config, logger);
  const toolRuntime = new ToolRuntime(logger, bus);
  const llmRouter = new LLMRouter(logger, bus);

  const kernel = new AgentKernel(
    config,
    logger,
    db,
    bus,
    workspace,
    toolRuntime,
    llmRouter
  );

  return { config, logger, db, bus, workspace, toolRuntime, llmRouter, kernel };
}

describe('DAGBuilder', () => {
  it('should validate and sort a linear dependency chain', () => {
    const steps: PlanStep[] = [
      { id: 'step-1', index: 1, goalId: 'g-1', description: 'Step 1', type: { kind: 'subtask' }, inputs: [], outputs: [], estimate: { tokens: 10, durationMs: 100, cost: 0 }, state: 'pending', retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false }, optional: false, checkpoint: true },
      { id: 'step-2', index: 2, goalId: 'g-1', description: 'Step 2', type: { kind: 'subtask' }, inputs: [], outputs: [], estimate: { tokens: 10, durationMs: 100, cost: 0 }, state: 'pending', retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false }, optional: false, checkpoint: true },
      { id: 'step-3', index: 3, goalId: 'g-1', description: 'Step 3', type: { kind: 'subtask' }, inputs: [], outputs: [], estimate: { tokens: 10, durationMs: 100, cost: 0 }, state: 'pending', retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false }, optional: false, checkpoint: true },
    ];
    const deps: Dependency[] = [
      { from: 'step-1', to: 'step-2' },
      { from: 'step-2', to: 'step-3' },
    ];

    expect(() => DAGBuilder.validateDAG(steps, deps)).not.toThrow();

    const sorted = DAGBuilder.topologicalSort(steps, deps);
    expect(sorted.map((s) => s.id)).toEqual(['step-1', 'step-2', 'step-3']);

    const levels = DAGBuilder.topologicalLevelSort(steps, deps);
    expect(levels).toHaveLength(3);
    expect(levels[0]![0]!.id).toBe('step-1');
    expect(levels[1]![0]!.id).toBe('step-2');
    expect(levels[2]![0]!.id).toBe('step-3');
  });

  it('should identify parallel groups in branched DAG', () => {
    const steps: PlanStep[] = [
      { id: 'step-0', index: 0, goalId: 'g-1', description: 'Step 0', type: { kind: 'subtask' }, inputs: [], outputs: [], estimate: { tokens: 10, durationMs: 100, cost: 0 }, state: 'pending', retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false }, optional: false, checkpoint: true },
      { id: 'step-1a', index: 1, goalId: 'g-1', description: 'Step 1a', type: { kind: 'subtask' }, inputs: [], outputs: [], estimate: { tokens: 10, durationMs: 100, cost: 0 }, state: 'pending', retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false }, optional: false, checkpoint: true },
      { id: 'step-1b', index: 2, goalId: 'g-1', description: 'Step 1b', type: { kind: 'subtask' }, inputs: [], outputs: [], estimate: { tokens: 10, durationMs: 100, cost: 0 }, state: 'pending', retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false }, optional: false, checkpoint: true },
      { id: 'step-2', index: 3, goalId: 'g-1', description: 'Step 2', type: { kind: 'subtask' }, inputs: [], outputs: [], estimate: { tokens: 10, durationMs: 100, cost: 0 }, state: 'pending', retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false }, optional: false, checkpoint: true },
    ];
    const deps: Dependency[] = [
      { from: 'step-0', to: 'step-1a' },
      { from: 'step-0', to: 'step-1b' },
      { from: 'step-1a', to: 'step-2' },
      { from: 'step-1b', to: 'step-2' },
    ];

    const levels = DAGBuilder.topologicalLevelSort(steps, deps);
    expect(levels).toHaveLength(3);
    expect(levels[0]!.map((s) => s.id)).toEqual(['step-0']);
    expect(levels[1]!.map((s) => s.id).sort()).toEqual(['step-1a', 'step-1b']);
    expect(levels[2]!.map((s) => s.id)).toEqual(['step-2']);
  });

  it('should throw on cyclic dependencies', () => {
    const steps: PlanStep[] = [
      { id: 'step-a', index: 1, goalId: 'g-1', description: 'Step A', type: { kind: 'subtask' }, inputs: [], outputs: [], estimate: { tokens: 10, durationMs: 100, cost: 0 }, state: 'pending', retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false }, optional: false, checkpoint: true },
      { id: 'step-b', index: 2, goalId: 'g-1', description: 'Step B', type: { kind: 'subtask' }, inputs: [], outputs: [], estimate: { tokens: 10, durationMs: 100, cost: 0 }, state: 'pending', retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false }, optional: false, checkpoint: true },
    ];
    const deps: Dependency[] = [
      { from: 'step-a', to: 'step-b' },
      { from: 'step-b', to: 'step-a' },
    ];

    expect(() => DAGBuilder.validateDAG(steps, deps)).toThrow('Cyclic dependency detected');
  });

  it('should return ready steps dynamically as prerequisites finish', () => {
    const steps: PlanStep[] = [
      { id: 's1', index: 1, goalId: 'g', description: 'S1', type: { kind: 'subtask' }, inputs: [], outputs: [], estimate: { tokens: 10, durationMs: 100, cost: 0 }, state: 'pending', retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false }, optional: false, checkpoint: true },
      { id: 's2', index: 2, goalId: 'g', description: 'S2', type: { kind: 'subtask' }, inputs: [], outputs: [], estimate: { tokens: 10, durationMs: 100, cost: 0 }, state: 'pending', retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false }, optional: false, checkpoint: true },
    ];
    const deps: Dependency[] = [{ from: 's1', to: 's2' }];

    const readyInitial = DAGBuilder.getReadySteps(steps, deps, new Set());
    expect(readyInitial.map((s) => s.id)).toEqual(['s1']);

    const readyAfterS1 = DAGBuilder.getReadySteps(steps, deps, new Set(['s1']));
    expect(readyAfterS1.map((s) => s.id)).toEqual(['s2']);
  });
});

describe('GoalDecomposer', () => {
  it('should decompose a complex goal into 4 dependent subtasks', async () => {
    const { logger } = createMockInfrastructure();
    const decomposer = new GoalDecomposer(logger);

    const plan = await decomposer.decompose('Refactor authentication module and run test suite');

    expect(plan.steps.length).toBe(4);
    expect(plan.dependencies.length).toBeGreaterThanOrEqual(3);
    expect(plan.version).toBe(1);
    expect(plan.rootGoal.description).toContain('Refactor authentication module');

    // Verify topological order
    expect(() => DAGBuilder.validateDAG(plan.steps, plan.dependencies)).not.toThrow();
  });
});

describe('DynamicReplanner', () => {
  it('should insert recovery step and update dependencies on step failure', async () => {
    const { logger } = createMockInfrastructure();
    const decomposer = new GoalDecomposer(logger);
    const replanner = new DynamicReplanner(logger);

    const initialPlan = await decomposer.decompose('Build and test API server');
    // Simulate step 1 completed, step 2 failed
    initialPlan.steps[0]!.state = 'completed';
    const failedStepId = initialPlan.steps[1]!.id;

    const replanned = await replanner.replan(
      initialPlan,
      failedStepId,
      'TypeScript syntax error in routes/auth.ts'
    );

    expect(replanned.version).toBe(2);
    expect(replanned.steps.length).toBeGreaterThan(initialPlan.steps.length);
    expect(replanned.rationale).toContain('routes/auth.ts');

    // Verify the new DAG is valid
    expect(() => DAGBuilder.validateDAG(replanned.steps, replanned.dependencies)).not.toThrow();
  });

  it('should reject replanning beyond maxReplans policy', async () => {
    const { logger } = createMockInfrastructure();
    const decomposer = new GoalDecomposer(logger);
    const replanner = new DynamicReplanner(logger, undefined, { maxReplans: 1 });

    const plan = await decomposer.decompose('Test task');
    plan.version = 2; // already replanned once

    await expect(replanner.replan(plan, plan.steps[0]!.id, 'Error')).rejects.toThrow(
      'exceeded maximum allowed replans'
    );
  });
});

describe('Planner & PlanExecutor Integration', () => {
  it('should execute a 4-step plan to completion through the Kernel', async () => {
    const { kernel, logger, bus } = createMockInfrastructure();

    // Mock Kernel runner to succeed all subtasks
    kernel.setReasoningEngine({
      async runTask(task: Task) {
        return {
          output: `Step completed successfully: ${task.description}`,
          steps: [{ step: 1, action: 'finish', observation: 'Done', success: true }],
        };
      },
    });
    await kernel.boot();

    const planner = new Planner(kernel, logger, bus);
    const result = await planner.executeGoal('Refactor database queries and run integration tests');

    expect(result.success).toBe(true);
    expect(result.completedSteps).toBe(4);
    expect(result.totalSteps).toBe(4);
    expect(result.version).toBe(1);
    expect(result.reflection.outcome).toBe('success');
    expect(result.reflection.failures).toHaveLength(0);

    await kernel.shutdown();
  });

  it('should recover via dynamic replanning when a step fails in execution', async () => {
    const { kernel, logger, bus } = createMockInfrastructure();

    let step3Attempt = 0;
    kernel.setReasoningEngine({
      async runTask(task: Task) {
        if (task.description.includes('Verify') && step3Attempt === 0) {
          step3Attempt++;
          throw new Error('Vitest test suite failed with 2 assertions');
        }
        return {
          output: `Step completed: ${task.description}`,
          steps: [{ step: 1, action: 'finish', observation: 'Success', success: true }],
        };
      },
    });
    await kernel.boot();

    const planner = new Planner(kernel, logger, bus);
    const result = await planner.executeGoal('Refactor database queries and run integration tests');

    expect(result.success).toBe(true);
    expect(result.version).toBe(2); // replanned from v1 to v2!
    expect(result.reflection.outcome).toBe('success');
    expect(result.reflection.failures).toHaveLength(1);
    expect(result.reflection.failures[0]!.wasRecoverable).toBe(true);

    await kernel.shutdown();
  });
});
