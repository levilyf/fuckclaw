import { IMetricsRegistry } from '../types.js';

export class MetricsCollector {
  constructor(private registry: IMetricsRegistry) {}

  recordTaskStarted(): void {
    this.registry.incrementCounter('tasks.total');
    this.registry.incrementCounter('tasks.active');
  }

  recordTaskCompleted(): void {
    this.registry.incrementCounter('tasks.completed');
  }

  recordTaskFailed(): void {
    this.registry.incrementCounter('tasks.failed');
  }

  recordToolExecution(_toolName: string, success: boolean, _durationMs?: number): void {
    this.registry.incrementCounter('tools.executed');
    if (!success) {
      this.registry.incrementCounter('tools.failed');
    }
  }

  recordLLMCall(promptTokens: number, completionTokens: number, costUsd: number, latencyMs: number): void {
    this.registry.incrementCounter('llm.requests');
    this.registry.incrementCounter('llm.prompt_tokens', promptTokens);
    this.registry.incrementCounter('llm.completion_tokens', completionTokens);
    this.registry.recordGauge('llm.cost_usd', costUsd);
    this.registry.recordHistogram('llm.latency_ms', latencyMs);
  }
}
