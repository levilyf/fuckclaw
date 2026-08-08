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

export interface ITracer {
  startSpan(name: string, options?: { traceId?: string; module?: string; attributes?: Record<string, any> }): ISpan;
  getActiveSpan(): ISpan | undefined;
  withSpan<T>(name: string, fn: (span: ISpan) => Promise<T>, options?: { module?: string }): Promise<T>;
  getCompletedSpans(traceId?: string): SpanData[];
}

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

export interface AuditEntry {
  id?: string;
  timestamp?: string;
  action: string;
  actor: string;
  target?: string;
  metadata?: Record<string, unknown>;
  status: 'success' | 'failure';
}

export interface TimelineStep {
  step: number;
  thought?: string;
  action?: string;
  observation?: string;
  timestamp: number;
  durationMs?: number;
}

export interface ReasoningTimeline {
  taskId: string;
  steps: TimelineStep[];
  startedAt: number;
  completedAt?: number;
}
