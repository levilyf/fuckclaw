import { describe, it, expect, vi } from 'vitest';
import { Logger } from '../src/index.js';
import { ConfigManager } from '@fuckclaw/config';

describe('Observability RFC 18 Compliance', () => {
  it('should emit structured JSON logs with module and level filtering', () => {
    const configManager = new ConfigManager({
      system: { logLevel: 'info' },
    } as any);

    const logger = new Logger(configManager);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.log({
      level: 'debug',
      module: 'kernel',
      message: 'Debug message should be suppressed at info level',
    });
    expect(consoleSpy).not.toHaveBeenCalled();

    logger.log({
      level: 'info',
      module: 'kernel',
      message: 'Task initiated',
      taskId: 'task-123',
    });
    expect(consoleSpy).toHaveBeenCalled();
    const loggedJson = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(loggedJson.level).toBe('info');
    expect(loggedJson.module).toBe('kernel');
    expect(loggedJson.taskId).toBe('task-123');

    consoleSpy.mockRestore();
  });

  it('should provide distributed tracing with nested spans and attributes', async () => {
    const configManager = new ConfigManager();
    const logger = new Logger(configManager);
    const tracer = logger.getTracer();

    const rootSpan = tracer.startSpan('kernel.task.execute', { module: 'kernel' });
    rootSpan.setAttribute('taskId', 'task-999');

    await tracer.withSpan(
      'context.build',
      async (childSpan) => {
        childSpan.setAttribute('memory.items', 5);
        childSpan.addEvent('cache_hit', { items: 2 });
      },
      { module: 'context' }
    );

    rootSpan.end();

    const completed = tracer.getCompletedSpans(rootSpan.traceId);
    expect(completed.length).toBe(2);
    expect(completed[0]!.name).toBe('context.build');
    expect(completed[0]!.parentSpanId).toBe(rootSpan.spanId);
    expect(completed[1]!.name).toBe('kernel.task.execute');
    expect(completed[1]!.attributes.taskId).toBe('task-999');
  });

  it('should record and aggregate system metrics', () => {
    const configManager = new ConfigManager();
    const logger = new Logger(configManager);
    const metrics = logger.getMetrics();

    metrics.incrementCounter('tasks.total', 10);
    metrics.incrementCounter('tasks.completed', 8);
    metrics.incrementCounter('tasks.failed', 2);
    metrics.recordGauge('tasks.active', 3);

    metrics.incrementCounter('llm.requests', 5);
    metrics.incrementCounter('llm.prompt_tokens', 1200);
    metrics.incrementCounter('llm.completion_tokens', 450);
    metrics.recordGauge('llm.cost_usd', 0.035);
    metrics.recordHistogram('llm.latency_ms', 100);
    metrics.recordHistogram('llm.latency_ms', 200);

    const snapshot = metrics.getSnapshot();
    expect(snapshot.tasks.total).toBe(10);
    expect(snapshot.tasks.completed).toBe(8);
    expect(snapshot.tasks.active).toBe(3);
    expect(snapshot.llm.totalPromptTokens).toBe(1200);
    expect(snapshot.llm.avgLatencyMs).toBe(150);
  });
});
