import { StepResult } from '@fuckclaw/kernel';
import { EvaluationResult } from './state-evaluator.js';

export interface ReasoningBranch {
  id: string;
  depth: number;
  steps: StepResult[];
  evaluation: EvaluationResult;
  contextSummary: string;
  finalOutput?: string;
}

export interface BeamSearchConfig {
  beamWidth?: number;
  maxDepth?: number;
  earlyStopScore?: number;
}

/**
 * Beam Search Engine (§11.4.1)
 * Explores multiple reasoning branches, evaluates state quality, prunes low-scoring paths,
 * and converges on the optimal reasoning trajectory.
 */
export class BeamSearch {
  private beamWidth: number;
  public readonly maxDepth: number;
  private earlyStopScore: number;

  constructor(config: BeamSearchConfig = {}) {
    this.beamWidth = config.beamWidth ?? 3;
    this.maxDepth = config.maxDepth ?? 4;
    this.earlyStopScore = config.earlyStopScore ?? 0.90;
  }

  /**
   * Evaluates and prunes a set of candidate branches to the top `beamWidth` highest-scoring paths.
   */
  pruneBranches(branches: ReasoningBranch[]): ReasoningBranch[] {
    return [...branches]
      .sort((a, b) => b.evaluation.score - a.evaluation.score)
      .slice(0, this.beamWidth);
  }

  /**
   * Checks if any branch has reached termination threshold.
   */
  findWinningBranch(branches: ReasoningBranch[]): ReasoningBranch | null {
    for (const b of branches) {
      if (b.evaluation.isComplete || b.evaluation.score >= this.earlyStopScore) {
        return b;
      }
    }
    return null;
  }

  /**
   * Selects the highest-scoring branch among all explored paths.
   */
  selectBestBranch(branches: ReasoningBranch[]): ReasoningBranch {
    if (branches.length === 0) {
      throw new Error('Cannot select best branch from empty branch collection');
    }
    return [...branches].sort((a, b) => b.evaluation.score - a.evaluation.score)[0]!;
  }
}
