import { IAgentKernel, Task, TaskState } from '@fuckclaw/kernel';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import {
  ScheduleTrigger,
  WebhookRequest,
  WebhookResponse,
} from './types.js';
import { CronRunner } from './cron/cron-runner.js';
import { FSWatcherManager } from './watchers/fs-watcher.js';
import { WebhookHandler } from './webhooks/webhook-handler.js';
import { SystemEvent } from '@fuckclaw/core';
import { ulid } from 'ulidx';

export class Scheduler {
  private triggers: Map<string, ScheduleTrigger> = new Map();
  private cronRunner: CronRunner;
  private fsWatcher: FSWatcherManager;
  private webhookHandler: WebhookHandler;
  private isRunning: boolean = false;
  private unsubscribers: Array<() => void> = [];

  constructor(
    private kernel: IAgentKernel,
    private logger: IObservability,
    private eventBus: IEventBus,
    workspace: IWorkspaceManager,
    private persistence?: IPersistenceLayer
  ) {
    this.cronRunner = new CronRunner(logger, async (trigger) => {
      await this.fireTrigger(trigger.id);
    });

    this.fsWatcher = new FSWatcherManager(workspace, logger, async (trigger, eventContext) => {
      await this.fireTrigger(trigger.id, eventContext);
    });

    this.webhookHandler = new WebhookHandler(logger, async (trigger, eventContext) => {
      const task = await this.fireTrigger(trigger.id, eventContext);
      return task?.id;
    });
  }

  registerTrigger(trigger: ScheduleTrigger): void {
    this.triggers.set(trigger.id, trigger);
    this.logger.log({
      level: 'info',
      module: 'scheduler',
      message: `Registered scheduler trigger "${trigger.name}" (${trigger.id}) [${trigger.source.type}]`,
    });

    this.persistSchedule(trigger);

    if (this.isRunning && trigger.enabled) {
      if (trigger.source.type === 'interval' || trigger.source.type === 'cron') {
        this.cronRunner.scheduleTrigger(trigger);
      } else if (trigger.source.type === 'file_watch') {
        this.fsWatcher.watchTrigger(trigger);
      } else if (trigger.source.type === 'event_bus') {
        this.setupEventBusTrigger(trigger);
      }
    }
  }

  unregisterTrigger(triggerId: string): void {
    const trigger = this.triggers.get(triggerId);
    if (trigger) {
      this.cronRunner.unscheduleTrigger(triggerId);
      this.fsWatcher.unwatchTrigger(triggerId);
      this.triggers.delete(triggerId);
    }
  }

  getTrigger(triggerId: string): ScheduleTrigger | undefined {
    return this.triggers.get(triggerId);
  }

  listTriggers(): ScheduleTrigger[] {
    return Array.from(this.triggers.values());
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    this.logger.log({
      level: 'info',
      module: 'scheduler',
      message: `Starting Scheduler with ${this.triggers.size} registered triggers...`,
    });

    const triggerList = Array.from(this.triggers.values());
    this.cronRunner.start(triggerList);
    this.fsWatcher.start(triggerList);

    for (const trigger of triggerList) {
      if (trigger.enabled && trigger.source.type === 'event_bus') {
        this.setupEventBusTrigger(trigger);
      }
    }

    await this.eventBus.emit('scheduler.started', { timestamp: Date.now() });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    this.cronRunner.stop();
    this.fsWatcher.stop();

    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    this.logger.log({
      level: 'info',
      module: 'scheduler',
      message: 'Scheduler stopped cleanly',
    });

    await this.eventBus.emit('scheduler.stopped', { timestamp: Date.now() });
  }

  async handleWebhook(request: WebhookRequest): Promise<WebhookResponse> {
    return this.webhookHandler.handleWebhook(Array.from(this.triggers.values()), request);
  }

  async fireTrigger(
    triggerId: string,
    eventContext?: Record<string, unknown>
  ): Promise<Task | null> {
    const trigger = this.triggers.get(triggerId);
    if (!trigger || !trigger.enabled) {
      return null;
    }

    // 1. Guard check
    if (trigger.guard) {
      const allowed = await trigger.guard(eventContext);
      if (!allowed) {
        this.logger.log({
          level: 'debug',
          module: 'scheduler',
          message: `Trigger ${triggerId} guard evaluated to false; skipping firing`,
        });
        return null;
      }
    }

    // 2. Deduplication check
    const taskDescription = this.renderTaskDescription(trigger.taskTemplate.description, eventContext);
    if (trigger.deduplicate) {
      const activeTasks = this.kernel.listTasks ? this.kernel.listTasks() : [];
      const duplicate = activeTasks.find(
        (t) =>
          (t.state === TaskState.EXECUTING || t.state === TaskState.PENDING) &&
          t.description === taskDescription
      );
      if (duplicate) {
        this.logger.log({
          level: 'debug',
          module: 'scheduler',
          message: `Trigger ${triggerId} deduplicated: identical task is already active`,
        });
        return null;
      }
    }

    trigger.stats.totalFired++;
    trigger.stats.lastFired = Date.now();

    this.logger.log({
      level: 'info',
      module: 'scheduler',
      message: `Trigger "${trigger.name}" fired. Submitting scheduled task to Kernel: "${taskDescription}"`,
      metadata: { triggerId, totalFired: trigger.stats.totalFired },
    });

    await this.eventBus.emit('scheduler.trigger.fired', {
      triggerId: trigger.id,
      triggerName: trigger.name,
      timestamp: trigger.stats.lastFired,
    });

    try {
      const task = await this.kernel.submitTask({
        description: taskDescription,
        source: {
          type: 'schedule',
          triggerId: trigger.id,
          triggerName: trigger.name,
        },
        priority: trigger.taskTemplate.priority ?? 20,
        tags: trigger.taskTemplate.tags ?? ['scheduled'],
        budget: trigger.taskTemplate.budget,
      });

      trigger.stats.lastResult = 'success';
      this.persistSchedule(trigger);
      this.recordScheduleHistory(trigger.id, 'success', task.id);
      return task;
    } catch (err: any) {
      trigger.stats.lastResult = 'failure';
      this.persistSchedule(trigger);
      this.recordScheduleHistory(trigger.id, 'failure', undefined, err.message || String(err));
      this.logger.log({
        level: 'error',
        module: 'scheduler',
        message: `Task spawned by trigger "${trigger.name}" failed: ${err.message}`,
        metadata: { triggerId: trigger.id, error: String(err) },
      });
      return null;
    }
  }

  private setupEventBusTrigger(trigger: ScheduleTrigger) {
    if (trigger.source.type !== 'event_bus') return;
    const eventType = trigger.source.eventType;

    const unsubscribe = this.eventBus.subscribe(eventType, async (event: SystemEvent) => {
      await this.fireTrigger(trigger.id, { event: event.payload, eventType: event.type });
    });

    this.unsubscribers.push(unsubscribe);
  }

  private renderTaskDescription(template: string, context?: Record<string, unknown>): string {
    if (!context) return template;
    let result = template;
    for (const [key, value] of Object.entries(context)) {
      result = result.replace(new RegExp(`{${key}}`, 'g'), String(value));
    }
    return result;
  }

  private persistSchedule(trigger: ScheduleTrigger) {
    if (!this.persistence) return;
    try {
      this.persistence.execute(
        `INSERT INTO schedules (id, name, enabled, source_json, task_template_json, stats_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           enabled = excluded.enabled,
           source_json = excluded.source_json,
           task_template_json = excluded.task_template_json,
           stats_json = excluded.stats_json,
           updated_at = excluded.updated_at`,
        [
          trigger.id,
          trigger.name,
          trigger.enabled ? 1 : 0,
          JSON.stringify(trigger.source),
          JSON.stringify(trigger.taskTemplate),
          JSON.stringify(trigger.stats),
          Date.now(),
          Date.now(),
        ]
      );
    } catch {}
  }

  private recordScheduleHistory(scheduleId: string, result: string, taskId?: string, error?: string) {
    if (!this.persistence) return;
    try {
      this.persistence.execute(
        `INSERT INTO schedule_history (id, schedule_id, fired_at, result, task_id, error)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [ulid(), scheduleId, Date.now(), result, taskId ?? null, error ?? null]
      );
    } catch {}
  }
}
