import { ulid } from 'ulidx';
import { AuditEntry } from '../types.js';

export class AuditLogger {
  private entries: AuditEntry[] = [];

  audit(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const fullEntry: AuditEntry = {
      ...entry,
      id: ulid(),
      timestamp: new Date().toISOString(),
    };
    this.entries.push(fullEntry);
    return fullEntry;
  }

  getEntries(actor?: string): AuditEntry[] {
    if (actor) {
      return this.entries.filter((e) => e.actor === actor);
    }
    return [...this.entries];
  }
}
