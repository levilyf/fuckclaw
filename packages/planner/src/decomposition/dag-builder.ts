import { PlanStep, Dependency } from '../types.js';
import { FuckClawError } from '@fuckclaw/core';

export class DAGBuilder {
  /**
   * Validates that the plan has no cycles and all dependencies refer to existing step IDs.
   */
  static validateDAG(steps: PlanStep[], dependencies: Dependency[]): void {
    const stepIds = new Set(steps.map((s) => s.id));

    // 1. Verify dependency endpoints exist
    for (const dep of dependencies) {
      if (!stepIds.has(dep.from)) {
        throw new FuckClawError(
          'FC_PLANNER_INVALID_DEPENDENCY',
          `Dependency 'from' step ID ${dep.from} does not exist in plan steps`
        );
      }
      if (!stepIds.has(dep.to)) {
        throw new FuckClawError(
          'FC_PLANNER_INVALID_DEPENDENCY',
          `Dependency 'to' step ID ${dep.to} does not exist in plan steps`
        );
      }
      if (dep.from === dep.to) {
        throw new FuckClawError(
          'FC_PLANNER_CYCLIC_DEPENDENCY',
          `Self-dependency detected on step ${dep.from}`
        );
      }
    }

    // 2. Cycle detection via Kahn's algorithm
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const s of steps) {
      inDegree.set(s.id, 0);
      adj.set(s.id, []);
    }

    for (const dep of dependencies) {
      inDegree.set(dep.to, (inDegree.get(dep.to) ?? 0) + 1);
      adj.get(dep.from)?.push(dep.to);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(id);
      }
    }

    let visitedCount = 0;
    while (queue.length > 0) {
      const u = queue.shift()!;
      visitedCount++;

      for (const v of adj.get(u) || []) {
        const newDeg = (inDegree.get(v) ?? 1) - 1;
        inDegree.set(v, newDeg);
        if (newDeg === 0) {
          queue.push(v);
        }
      }
    }

    if (visitedCount !== steps.length) {
      throw new FuckClawError(
        'FC_PLANNER_CYCLIC_DEPENDENCY',
        'Cyclic dependency detected in task plan DAG'
      );
    }
  }

  /**
   * Topologically sorts steps so every dependency is executed before its dependents.
   */
  static topologicalSort(steps: PlanStep[], dependencies: Dependency[]): PlanStep[] {
    this.validateDAG(steps, dependencies);

    const stepMap = new Map(steps.map((s) => [s.id, s]));
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const s of steps) {
      inDegree.set(s.id, 0);
      adj.set(s.id, []);
    }

    for (const dep of dependencies) {
      inDegree.set(dep.to, (inDegree.get(dep.to) ?? 0) + 1);
      adj.get(dep.from)?.push(dep.to);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(id);
      }
    }

    const sorted: PlanStep[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      sorted.push(stepMap.get(u)!);

      for (const v of adj.get(u) || []) {
        const newDeg = (inDegree.get(v) ?? 1) - 1;
        inDegree.set(v, newDeg);
        if (newDeg === 0) {
          queue.push(v);
        }
      }
    }

    return sorted;
  }

  /**
   * Partitions steps into execution levels (waves) where steps in the same level
   * can execute concurrently / without mutual dependencies.
   */
  static topologicalLevelSort(steps: PlanStep[], dependencies: Dependency[]): PlanStep[][] {
    this.validateDAG(steps, dependencies);

    const stepMap = new Map(steps.map((s) => [s.id, s]));
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const s of steps) {
      inDegree.set(s.id, 0);
      adj.set(s.id, []);
    }

    for (const dep of dependencies) {
      inDegree.set(dep.to, (inDegree.get(dep.to) ?? 0) + 1);
      adj.get(dep.from)?.push(dep.to);
    }

    let currentLevel: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) {
        currentLevel.push(id);
      }
    }

    const levels: PlanStep[][] = [];

    while (currentLevel.length > 0) {
      levels.push(currentLevel.map((id) => stepMap.get(id)!));
      const nextLevel: string[] = [];

      for (const u of currentLevel) {
        for (const v of adj.get(u) || []) {
          const newDeg = (inDegree.get(v) ?? 1) - 1;
          inDegree.set(v, newDeg);
          if (newDeg === 0) {
            nextLevel.push(v);
          }
        }
      }

      currentLevel = nextLevel;
    }

    return levels;
  }

  /**
   * Returns list of steps whose dependencies are all satisfied and are in 'pending' or 'ready' state.
   */
  static getReadySteps(
    steps: PlanStep[],
    dependencies: Dependency[],
    completedStepIds: Set<string>
  ): PlanStep[] {
    const ready: PlanStep[] = [];

    for (const step of steps) {
      if (completedStepIds.has(step.id)) {
        continue;
      }
      if (step.state !== 'pending' && step.state !== 'ready') {
        continue;
      }

      // Check if all prerequisites of this step are completed
      const prerequisites = dependencies
        .filter((d) => d.to === step.id)
        .map((d) => d.from);

      const allMet = prerequisites.every((pId) => completedStepIds.has(pId));
      if (allMet) {
        ready.push(step);
      }
    }

    return ready;
  }
}
