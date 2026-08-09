import { ulid } from 'ulidx';

export interface RecordedTraceStep {
  step: number;
  thought?: string;
  action?: string;
  observation?: unknown;
  success: boolean;
  timestamp: number;
}

export interface RecordedTrace {
  taskId: string;
  goal: string;
  steps: RecordedTraceStep[];
  output?: string;
  success: boolean;
  startedAt: number;
  completedAt?: number;
}

export interface ReplayEvent {
  stepIndex: number;
  totalSteps: number;
  step: RecordedTraceStep;
  relativeTimeMs: number;
}

export interface DivergencePoint {
  stepIndex: number;
  expectedAction?: string;
  actualAction?: string;
  expectedObservation?: unknown;
  actualObservation?: unknown;
  reason: string;
}

export interface ReplayDiagnosticReport {
  sessionId: string;
  taskId: string;
  stepsReplayed: number;
  divergences: DivergencePoint[];
  deterministicMatch: boolean;
  durationMs: number;
}

export interface ITraceReplayer {
  step(): ReplayEvent | null;
  seekTo(stepIndex: number): void;
  replayAll(): Promise<ReplayDiagnosticReport>;
}

/**
 * Deterministic Trace Replay Engine (§18.5)
 * Loads recorded reasoning traces, reconstructs execution sequences,
 * compares expected vs actual outcomes, and generates diagnostics.
 */
export class TraceReplayEngine implements ITraceReplayer {
  public readonly sessionId: string;
  private currentIndex: number = 0;

  constructor(
    private trace: RecordedTrace,
    private stepExecutor?: (step: RecordedTraceStep) => Promise<{ action?: string; observation?: unknown; success: boolean }>
  ) {
    this.sessionId = ulid();
  }

  step(): ReplayEvent | null {
    if (this.currentIndex >= this.trace.steps.length) {
      return null;
    }

    const currentStep = this.trace.steps[this.currentIndex]!;
    const event: ReplayEvent = {
      stepIndex: this.currentIndex + 1,
      totalSteps: this.trace.steps.length,
      step: currentStep,
      relativeTimeMs: currentStep.timestamp - this.trace.startedAt,
    };

    this.currentIndex++;
    return event;
  }

  seekTo(stepIndex: number): void {
    if (stepIndex < 0) {
      this.currentIndex = 0;
    } else if (stepIndex > this.trace.steps.length) {
      this.currentIndex = this.trace.steps.length;
    } else {
      this.currentIndex = stepIndex;
    }
  }

  async replayAll(): Promise<ReplayDiagnosticReport> {
    const start = Date.now();
    const divergences: DivergencePoint[] = [];
    let stepsReplayed = 0;

    for (let i = 0; i < this.trace.steps.length; i++) {
      const step = this.trace.steps[i]!;
      stepsReplayed++;

      if (this.stepExecutor) {
        try {
          const actualResult = await this.stepExecutor(step);
          if (actualResult.action && actualResult.action !== step.action) {
            divergences.push({
              stepIndex: i + 1,
              expectedAction: step.action,
              actualAction: actualResult.action,
              reason: `Action mismatch at step ${i + 1}`,
            });
          }
          if (actualResult.observation !== undefined && JSON.stringify(actualResult.observation) !== JSON.stringify(step.observation)) {
            divergences.push({
              stepIndex: i + 1,
              expectedObservation: step.observation,
              actualObservation: actualResult.observation,
              reason: `Observation divergence at step ${i + 1}`,
            });
          }
        } catch (err: any) {
          divergences.push({
            stepIndex: i + 1,
            reason: `Replay execution threw error: ${err.message}`,
          });
        }
      }
    }

    return {
      sessionId: this.sessionId,
      taskId: this.trace.taskId,
      stepsReplayed,
      divergences,
      deterministicMatch: divergences.length === 0,
      durationMs: Date.now() - start,
    };
  }
}
