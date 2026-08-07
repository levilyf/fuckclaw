import { IObservability } from '@fuckclaw/observability';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { ScheduleTrigger } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';

export class FSWatcherManager {
  private watchers: Map<string, fs.FSWatcher[]> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;

  constructor(
    private workspace: IWorkspaceManager,
    private logger: IObservability,
    private onTriggerDue: (trigger: ScheduleTrigger, eventContext: Record<string, unknown>) => Promise<void>
  ) {}

  start(triggers: ScheduleTrigger[]): void {
    this.isRunning = true;
    for (const trigger of triggers) {
      if (trigger.enabled && trigger.source.type === 'file_watch') {
        this.watchTrigger(trigger);
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    for (const watcherList of this.watchers.values()) {
      for (const watcher of watcherList) {
        watcher.close();
      }
    }
    this.watchers.clear();

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  watchTrigger(trigger: ScheduleTrigger): void {
    if (!this.isRunning || !trigger.enabled || trigger.source.type !== 'file_watch') return;

    this.unwatchTrigger(trigger.id);

    const source = trigger.source;
    const debounceMs = source.debounceMs ?? 200;
    const watcherList: fs.FSWatcher[] = [];

    for (const targetPath of source.paths) {
      const resolved = path.isAbsolute(targetPath)
        ? targetPath
        : path.join(this.workspace.getRoot(), targetPath);

      if (!fs.existsSync(resolved)) {
        continue;
      }

      try {
        const watcher = fs.watch(resolved, { recursive: false }, (_eventType, filename) => {
          const debounceKey = `${trigger.id}:${filename || targetPath}`;
          
          if (this.debounceTimers.has(debounceKey)) {
            clearTimeout(this.debounceTimers.get(debounceKey)!);
          }

          const timer = setTimeout(async () => {
            this.debounceTimers.delete(debounceKey);
            try {
              await this.onTriggerDue(trigger, {
                changedFile: filename ? path.join(targetPath, filename) : targetPath,
                resolvedPath: filename ? path.join(resolved, filename) : resolved,
                timestamp: Date.now(),
              });
            } catch (err: any) {
              this.logger.log({
                level: 'error',
                message: `File watcher trigger ${trigger.id} failed during execution`,
                metadata: { error: err.message || String(err) },
              });
            }
          }, debounceMs);

          this.debounceTimers.set(debounceKey, timer);
        });

        watcherList.push(watcher);
      } catch (err: any) {
        this.logger.log({
          level: 'warn',
          message: `Failed to watch path "${resolved}" for trigger ${trigger.id}`,
          metadata: { error: err.message || String(err) },
        });
      }
    }

    this.watchers.set(trigger.id, watcherList);
  }

  unwatchTrigger(triggerId: string): void {
    const watcherList = this.watchers.get(triggerId);
    if (watcherList) {
      for (const watcher of watcherList) {
        watcher.close();
      }
      this.watchers.delete(triggerId);
    }
  }
}
