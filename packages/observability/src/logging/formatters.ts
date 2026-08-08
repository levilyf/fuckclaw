import { LogEntry } from '../types.js';

export function formatJsonLog(entry: LogEntry): string {
  return JSON.stringify(entry);
}

export function formatPrettyLog(entry: LogEntry): string {
  const meta = entry.metadata ? ` ${JSON.stringify(entry.metadata)}` : '';
  const mod = entry.module ? `[${entry.module}] ` : '';
  return `[${entry.timestamp}] ${entry.level.toUpperCase()} ${mod}${entry.message}${meta}`;
}
