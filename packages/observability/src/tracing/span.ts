import { ulid } from 'ulidx';
import { ISpan, SpanData, SpanEvent } from '../types.js';

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
