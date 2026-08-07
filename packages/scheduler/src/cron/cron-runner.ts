import { IObservability } from '@fuckclaw/observability';
import { ScheduleTrigger } from '../types.js';

export class CronRunner {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;

  constructor(
    private logger: IObservability,
    private onTriggerDue: (trigger: ScheduleTrigger) => Promise<void>
  ) {}

  start(triggers: ScheduleTrigger[]): void {
    this.isRunning = true;
    for (const trigger of triggers) {
      if (trigger.enabled && (trigger.source.type === 'interval' || trigger.source.type === 'cron')) {
        this.scheduleTrigger(trigger);
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    for (const timer of this.timers.values()) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  scheduleTrigger(trigger: ScheduleTrigger): void {
    if (!this.isRunning || !trigger.enabled) return;

    // Clear existing timer if any
    this.unscheduleTrigger(trigger.id);

    if (trigger.source.type === 'interval') {
      const intervalMs = Math.max(50, trigger.source.intervalMs);
      const timer = setInterval(async () => {
        try {
          await this.onTriggerDue(trigger);
        } catch (err: any) {
          this.logger.log({
            level: 'error',
            message: `Interval trigger ${trigger.id} failed during execution`,
            metadata: { error: err.message || String(err) },
          });
        }
      }, intervalMs);
      this.timers.set(trigger.id, timer);
    } else if (trigger.source.type === 'cron') {
      const expression = trigger.source.expression;
      // Cron expression: check every minute or on calculated next interval
      const timer = setInterval(async () => {
        if (this.matchesCron(expression, new Date())) {
          try {
            await this.onTriggerDue(trigger);
          } catch (err: any) {
            this.logger.log({
              level: 'error',
              message: `Cron trigger ${trigger.id} failed during execution`,
              metadata: { error: err.message || String(err) },
            });
          }
        }
      }, 60000);
      this.timers.set(trigger.id, timer);
    }
  }

  unscheduleTrigger(triggerId: string): void {
    const timer = this.timers.get(triggerId);
    if (timer) {
      clearInterval(timer);
      clearTimeout(timer);
      this.timers.delete(triggerId);
    }
  }

  /**
   * Evaluates standard 5-part cron: minute (0-59), hour (0-23), dayOfMonth (1-31), month (1-12), dayOfWeek (0-6)
   */
  matchesCron(expression: string, date: Date): boolean {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) return false;

    const [minExp, hrExp, domExp, monExp, dowExp] = parts;
    const min = date.getMinutes();
    const hr = date.getHours();
    const dom = date.getDate();
    const mon = date.getMonth() + 1;
    const dow = date.getDay();

    return (
      this.matchesCronField(minExp!, min, 0, 59) &&
      this.matchesCronField(hrExp!, hr, 0, 23) &&
      this.matchesCronField(domExp!, dom, 1, 31) &&
      this.matchesCronField(monExp!, mon, 1, 12) &&
      this.matchesCronField(dowExp!, dow, 0, 6)
    );
  }

  private matchesCronField(field: string, current: number, min: number, max: number): boolean {
    if (field === '*') return true;

    // Step values: */5
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10);
      return !isNaN(step) && step > 0 && current % step === 0;
    }

    // Comma-separated list: 1,2,3
    if (field.includes(',')) {
      return field.split(',').some((sub) => this.matchesCronField(sub.trim(), current, min, max));
    }

    // Range: 1-5
    if (field.includes('-')) {
      const [start, end] = field.split('-').map((v) => parseInt(v, 10));
      return start !== undefined && end !== undefined && current >= start && current <= end;
    }

    // Exact value
    const exact = parseInt(field, 10);
    return exact === current;
  }
}
