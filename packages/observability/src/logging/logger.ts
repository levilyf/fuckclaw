import { IConfigManager } from '@fuckclaw/config';
import { IObservability, LogEntry, ITracer, IMetricsRegistry } from '../types.js';
import { Tracer } from '../tracing/tracer.js';
import { MetricsRegistry } from '../metrics/registry.js';
import { formatJsonLog } from './formatters.js';

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

      const out = formatJsonLog(fullEntry);
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
