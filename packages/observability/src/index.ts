import { IConfigManager } from '@fuckclaw/config';
import { ulid } from 'ulidx';

// ─── 1. Structured Logging (§18.2.1) ──────────────────────────────────────────

export interface LogErrorPayload {
  name: string;
  message: string;
  stack?: string;
}

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  module?: string;
  message: string;
  taskId?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
  error?: LogErrorPayload;
}

export interface IObservability {
  log(entry: Omit<LogEntry, 'timestamp'>): void;
  info?(message: string, metadata?: Record<string, unknown>): void;
  warn?(message: string, metadata?: Record<string, unknown>): void;
  error?(message: string, metadata?: Record<string, unknown>): void;
  debug?(message: string, metadata?: Record<string, unknown>): void;
  getTracer?(): ITracer;
  getMetrics?(): IMetricsRegistry;
}

export class Logger implements IObservability {
  private tracer: Tracer;
  private metrics: MetricsRegistry;

  constructor(private configManager: IConfigManager) {
    this.tracer = new Tracer();
    this.metrics = new MetricsRegistry();
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.log({ level: 'info', message, metadata });
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log({ level: 'warn', message, metadata });
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.log({ level: 'error', message, metadata });
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log({ level: 'debug', message, metadata });
  }

  log(entry: Omit<LogEntry, 'timestamp'>): void {
    const config = this.configManager.get();
    const configuredLevel = config.system?.logLevel || config.logging?.level || 'info';
    const levels: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };

    const entryLevelPriority = levels[entry.level] ?? 1;
    const configuredLevelPriority = levels[configuredLevel] ?? 1;

    if (entryLevelPriority >= configuredLevelPriority) {
      const fullEntry: LogEntry = {
        ...entry,
        timestamp: new Date().toISOString(),
      };

      const out = JSON.stringify(fullEntry);
      if (entry.level === 'error' || entry.level === 'fatal') {
        console.error(out);
      } else {
        console.log(out);
      }
    }
  }

  getTracer(): ITracer {
    return this.tracer;
  }

  getMetrics(): IMetricsRegistry {
    return this.metrics;
  }
}

// ─── 2. Distributed Tracing (§18.2.2) ─────────────────────────────────────────

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface SpanData {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  module: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'ok' | 'error';
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

export interface ISpan {
  readonly spanId: string;
  readonly traceId: string;
  setAttribute(key: string, value: string | number | boolean): this;
  addEvent(name: string, attributes?: Record<string, unknown>): this;
  setStatus(status: 'ok' | 'error'): this;
  end(): SpanData;
  getData(): SpanData;
}

export class Span implements ISpan {
  public readonly spanId: string;
  public readonly traceId: string;
  public readonly parentSpanId?: string;
  public readonly name: string;
  public readonly module: string;
  public readonly startTime: number;
  private endTime?: number;
  private duration?: number;
  private status: 'ok' | 'error' = 'ok';
  private attributes: Record<string, string | number | boolean> = {};
  private events: SpanEvent[] = [];

  constructor(options: {
    traceId: string;
    name: string;
    module?: string;
    parentSpanId?: string;
    attributes?: Record<string, string | number | boolean>;
  }) {
    this.spanId = ulid();
    this.traceId = options.traceId;
    this.parentSpanId = options.parentSpanId;
    this.name = options.name;
    this.module = options.module ?? 'system';
    this.startTime = Date.now();
    if (options.attributes) {
      this.attributes = { ...options.attributes };
    }
  }

  setAttribute(key: string, value: string | number | boolean): this {
    this.attributes[key] = value;
    return this;
  }

  addEvent(name: string, attributes?: Record<string, unknown>): this {
    this.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
    return this;
  }

  setStatus(status: 'ok' | 'error'): this {
    this.status = status;
    return this;
  }

  end(): SpanData {
    if (!this.endTime) {
      this.endTime = Date.now();
      this.duration = this.endTime - this.startTime;
    }
    return this.getData();
  }

  getData(): SpanData {
    return {
      spanId: this.spanId,
      traceId: this.traceId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      module: this.module,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration ?? (Date.now() - this.startTime),
      status: this.status,
      attributes: { ...this.attributes },
      events: [...this.events],
    };
  }
}

export interface ITracer {
  startSpan(name: string, options?: { traceId?: string; module?: string; attributes?: Record<string, any> }): ISpan;
  getActiveSpan(): ISpan | undefined;
  withSpan<T>(name: string, fn: (span: ISpan) => Promise<T>, options?: { module?: string }): Promise<T>;
  getCompletedSpans(traceId?: string): SpanData[];
}

export class Tracer implements ITracer {
  private activeSpanStack: ISpan[] = [];
  private completedSpans: SpanData[] = [];

  startSpan(
    name: string,
    options: { traceId?: string; module?: string; attributes?: Record<string, any> } = {}
  ): ISpan {
    const parentSpan = this.getActiveSpan();
    const traceId = options.traceId ?? parentSpan?.traceId ?? ulid();

    const span = new Span({
      traceId,
      name,
      module: options.module,
      parentSpanId: parentSpan?.spanId,
      attributes: options.attributes,
    });

    this.activeSpanStack.push(span);

    // Patch end to pop from stack and record
    const originalEnd = span.end.bind(span);
    span.end = () => {
      const data = originalEnd();
      const idx = this.activeSpanStack.indexOf(span);
      if (idx !== -1) {
        this.activeSpanStack.splice(idx, 1);
      }
      this.completedSpans.push(data);
      return data;
    };

    return span;
  }

  getActiveSpan(): ISpan | undefined {
    return this.activeSpanStack[this.activeSpanStack.length - 1];
  }

  async withSpan<T>(
    name: string,
    fn: (span: ISpan) => Promise<T>,
    options: { module?: string } = {}
  ): Promise<T> {
    const span = this.startSpan(name, options);
    try {
      const result = await fn(span);
      span.setStatus('ok');
      return result;
    } catch (err) {
      span.setStatus('error');
      span.addEvent('exception', { error: String(err) });
      throw err;
    } finally {
      span.end();
    }
  }

  getCompletedSpans(traceId?: string): SpanData[] {
    if (traceId) {
      return this.completedSpans.filter((s) => s.traceId === traceId);
    }
    return [...this.completedSpans];
  }
}

// ─── 3. Metrics Collection (§18.2.3) ──────────────────────────────────────────

export interface SystemMetrics {
  tasks: {
    active: number;
    completed: number;
    failed: number;
    total: number;
  };
  llm: {
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCostUsd: number;
    avgLatencyMs: number;
  };
  tools: {
    totalExecutions: number;
    failedExecutions: number;
  };
}

export interface IMetricsRegistry {
  incrementCounter(name: string, delta?: number): void;
  recordGauge(name: string, value: number): void;
  recordHistogram(name: string, value: number): void;
  getSnapshot(): SystemMetrics;
}

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
