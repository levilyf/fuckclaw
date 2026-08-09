import { StepResult } from '@fuckclaw/kernel';

export interface EvaluationResult {
  score: number;
  progressRatio: number;
  isComplete: boolean;
  rationale: string;
}

/**
 * State Evaluator (§11.4)
 * Scores the quality and goal progress of reasoning branches during tree/beam search.
 */
export class StateEvaluator {
  /**
   * Evaluates branch steps against task goal.
   * Returns score between 0.0 (total failure) and 1.0 (goal completely achieved).
   */
  static evaluate(goal: string, steps: StepResult[], finalOutput?: string): EvaluationResult {
    if (steps.length === 0) {
      return {
        score: 0.1,
        progressRatio: 0.1,
        isComplete: false,
        rationale: 'No steps executed yet',
      };
    }

    const lastStep = steps[steps.length - 1]!;
    const goalTerms = goal
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);

    let score = 0.5;
    let successfulSteps = 0;
    let failedSteps = 0;

    for (const s of steps) {
      if (s.success) {
        successfulSteps++;
      } else {
        failedSteps++;
      }
    }

    // Step success ratio impact (+- 0.3)
    const successRatio = successfulSteps / steps.length;
    score += (successRatio - 0.5) * 0.4;

    // Keyword relevance in latest observation / output (+- 0.2)
    const contentToExamine = `${lastStep.observation ?? ''} ${lastStep.thought ?? ''} ${finalOutput ?? ''}`.toLowerCase();
    let termMatches = 0;
    for (const term of goalTerms) {
      if (contentToExamine.includes(term)) {
        termMatches++;
      }
    }
    const keywordMatchRatio = goalTerms.length > 0 ? termMatches / goalTerms.length : 0.5;
    score += keywordMatchRatio * 0.2;

    // Check completion indicators
    const isCompleted =
      lastStep.action === 'finish' ||
      contentToExamine.includes('complete') ||
      contentToExamine.includes('completed') ||
      contentToExamine.includes('verified') ||
      contentToExamine.includes('success') ||
      contentToExamine.includes('done') ||
      (finalOutput !== undefined && finalOutput.length > 20);

    if (isCompleted && failedSteps === 0) {
      score = Math.max(score, 0.95);
    } else if (failedSteps > 0 && isCompleted) {
      score = Math.min(score, 0.75);
    }

    const boundedScore = Math.max(0.0, Math.min(1.0, Number(score.toFixed(4))));

    return {
      score: boundedScore,
      progressRatio: boundedScore,
      isComplete: isCompleted,
      rationale: `Success ratio: ${(successRatio * 100).toFixed(0)}%, Keyword match: ${(keywordMatchRatio * 100).toFixed(0)}%, Completed: ${isCompleted}`,
    };
  }
}
