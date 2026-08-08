import { ReasoningTimeline, TimelineStep } from '../types.js';

export class ReasoningTimelineTracker {
  private timelines: Map<string, ReasoningTimeline> = new Map();

  startTimeline(taskId: string): ReasoningTimeline {
    const timeline: ReasoningTimeline = {
      taskId,
      steps: [],
      startedAt: Date.now(),
    };
    this.timelines.set(taskId, timeline);
    return timeline;
  }

  recordStep(taskId: string, step: TimelineStep): void {
    const timeline = this.timelines.get(taskId);
    if (timeline) {
      timeline.steps.push(step);
    }
  }

  completeTimeline(taskId: string): ReasoningTimeline | undefined {
    const timeline = this.timelines.get(taskId);
    if (timeline) {
      timeline.completedAt = Date.now();
    }
    return timeline;
  }

  getTimeline(taskId: string): ReasoningTimeline | undefined {
    return this.timelines.get(taskId);
  }
}
