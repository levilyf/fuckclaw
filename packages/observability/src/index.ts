import { IConfigManager } from '@fuckclaw/config';

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface IObservability {
  log(entry: Omit<LogEntry, 'timestamp'>): void;
}

export class Logger implements IObservability {
  constructor(private configManager: IConfigManager) {}

  log(entry: Omit<LogEntry, 'timestamp'>): void {
    const config = this.configManager.get();
    const levels: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    
    if (levels[entry.level]! >= levels[config.logging.level]!) {
      const fullEntry: LogEntry = {
        ...entry,
        timestamp: new Date().toISOString(),
      };
      
      const out = JSON.stringify(fullEntry);
      if (entry.level === 'error') {
        console.error(out);
      } else {
        console.log(out);
      }
    }
  }
}
