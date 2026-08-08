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
      return {
        isProgressing: false,
        critique: `Step ${lastStep.step} failed on action "${lastStep.action}"`,
        recommendedAdjustment: 'Retry with alternative arguments or diagnostic command',
      };
    }

    return {
      isProgressing: true,
      critique: `Step ${lastStep.step} succeeded`,
    };
  }
}
