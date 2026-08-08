import { StepResult } from '@fuckclaw/kernel';

export interface ReflectionResult {
  isProgressing: boolean;
  critique: string;
  recommendedAdjustment?: string;
}

export class SelfReflector {
  static reflect(history: StepResult[]): ReflectionResult {
    if (history.length === 0) {
      return { isProgressing: true, critique: 'Initial state' };
    }

    const lastStep = history[history.length - 1]!;
    if (!lastStep.success) {
      const observationStr = typeof lastStep.observation === 'string' ? lastStep.observation : JSON.stringify(lastStep.observation || '');
      let adjustment = 'Diagnose root cause, verify input arguments, and retry with a corrected action.';
      
      if (/enoent|not found|does not exist/i.test(observationStr)) {
        adjustment = 'Target path or resource not found. Verify workspace directory structure or create parent directories before retrying.';
      } else if (/eacces|eperm|permission/i.test(observationStr)) {
        adjustment = 'Permission denied. Verify workspace isolation bounds and permissions.';
      } else if (/timeout/i.test(observationStr)) {
        adjustment = 'Execution timed out. Optimize command parameters or split into smaller operations.';
      }

      return {
        isProgressing: false,
        critique: `Step ${lastStep.step} failed on action "${lastStep.action}". Output: ${observationStr.slice(0, 150)}`,
        recommendedAdjustment: adjustment,
      };
    }

    return {
      isProgressing: true,
      critique: `Step ${lastStep.step} succeeded with verified observation`,
    };
  }
}
