import { IMetricsRegistry, SystemMetrics } from '../types.js';

export class MetricsRegistry implements IMetricsRegistry {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  incrementCounter(name: string, delta: number = 1): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + delta);
  }

  recordGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  recordHistogram(name: string, value: number): void {
    const values = this.histograms.get(name) || [];
    values.push(value);
    this.histograms.set(name, values);
  }

  getSnapshot(): SystemMetrics {
    const latencies = this.histograms.get('llm.latency_ms') || [];
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    return {
      tasks: {
        active: this.gauges.get('tasks.active') || 0,
        completed: this.counters.get('tasks.completed') || 0,
        failed: this.counters.get('tasks.failed') || 0,
        total: this.counters.get('tasks.total') || 0,
      },
      llm: {
        totalRequests: this.counters.get('llm.requests') || 0,
        totalPromptTokens: this.counters.get('llm.prompt_tokens') || 0,
        totalCompletionTokens: this.counters.get('llm.completion_tokens') || 0,
        totalCostUsd: this.gauges.get('llm.cost_usd') || 0,
        avgLatencyMs: avgLatency,
      },
      tools: {
        totalExecutions: this.counters.get('tools.executed') || 0,
        failedExecutions: this.counters.get('tools.failed') || 0,
      },
    };
  }
}
