import { ulid } from 'ulidx';
import { ITracer, ISpan, SpanData } from '../types.js';
import { Span } from './span.js';
import { TracingContext } from './context.js';

export class Tracer implements ITracer {
  private context = new TracingContext();
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

    this.context.push(span);

    // Patch end to pop from stack and record
    const originalEnd = span.end.bind(span);
    span.end = () => {
      const data = originalEnd();
      this.context.pop(span);
      this.completedSpans.push(data);
      return data;
    };

    return span;
  }

  getActiveSpan(): ISpan | undefined {
    return this.context.getActive();
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
