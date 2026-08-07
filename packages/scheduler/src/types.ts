import { TaskBudget } from '@fuckclaw/kernel';

export type TriggerSource =
  | { type: 'cron'; expression: string; timezone?: string }
  | { type: 'interval'; intervalMs: number }
  | { type: 'file_watch'; paths: string[]; events: Array<'create' | 'modify' | 'delete'>; debounceMs?: number }
  | { type: 'webhook'; path: string; method?: 'GET' | 'POST'; secret?: string }
  | { type: 'event_bus'; eventType: string; filter?: Record<string, unknown> };

export interface ScheduleTrigger {
  id: string;
  name: string;
  enabled: boolean;
  source: TriggerSource;
  taskTemplate: {
    description: string;
    priority?: number;
    budget?: Partial<TaskBudget>;
    tags?: string[];
  };
  guard?: (context?: Record<string, unknown>) => boolean | Promise<boolean>;
  deduplicate?: boolean;
  maxConcurrent?: number;
  stats: {
    totalFired: number;
    lastFired: number;
    lastResult: 'success' | 'failure' | null;
  };
}

export interface WebhookRequest {
  path: string;
  method: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface WebhookResponse {
  statusCode: number;
  message: string;
  taskId?: string;
}
