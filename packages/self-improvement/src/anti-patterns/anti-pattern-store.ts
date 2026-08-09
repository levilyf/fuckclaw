import { ulid } from 'ulidx';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { AntiPatternRecord } from '../types.js';

interface AntiPatternRow {
  id: string;
  context: string;
  mistake: string;
  consequence: string;
  corrective_action: string;
  confidence: number;
  occurrences: number;
  source_task_id: string | null;
  created_at: number;
  updated_at: number;
}

export class AntiPatternStore {
  constructor(
    private persistence: IPersistenceLayer,
    private logger?: IObservability
  ) {}

  public async record(
    item: Omit<AntiPatternRecord, 'id' | 'createdAt' | 'updatedAt' | 'occurrences'> & {
      occurrences?: number;
      id?: string;
    }
  ): Promise<AntiPatternRecord> {
    const existing = this.findByContextAndMistake(item.context, item.mistake);
    const now = Date.now();

    if (existing) {
      const updatedOccurrences = existing.occurrences + (item.occurrences ?? 1);
      const updatedConfidence = Math.min(1.0, existing.confidence + 0.1);

      this.persistence.execute(
        `UPDATE anti_patterns 
         SET occurrences = ?, confidence = ?, corrective_action = ?, updated_at = ?
         WHERE id = ?`,
        [updatedOccurrences, updatedConfidence, item.correctiveAction || existing.correctiveAction, now, existing.id]
      );

      return {
        ...existing,
        occurrences: updatedOccurrences,
        confidence: updatedConfidence,
        correctiveAction: item.correctiveAction || existing.correctiveAction,
        updatedAt: now,
      };
    }

    const id = item.id || ulid();
    const record: AntiPatternRecord = {
      id,
      context: item.context,
      mistake: item.mistake,
      consequence: item.consequence,
      correctiveAction: item.correctiveAction,
      confidence: item.confidence ?? 1.0,
      occurrences: item.occurrences ?? 1,
      sourceTaskId: item.sourceTaskId,
      createdAt: now,
      updatedAt: now,
    };

    this.persistence.execute(
      `INSERT INTO anti_patterns (id, context, mistake, consequence, corrective_action, confidence, occurrences, source_task_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.context,
        record.mistake,
        record.consequence,
        record.correctiveAction,
        record.confidence,
        record.occurrences,
        record.sourceTaskId || null,
        record.createdAt,
        record.updatedAt,
      ]
    );

    // Populate FTS if available
    try {
      this.persistence.execute(
        `INSERT INTO anti_patterns_fts (id, context, mistake, consequence, corrective_action)
         VALUES (?, ?, ?, ?, ?)`,
        [record.id, record.context, record.mistake, record.consequence, record.correctiveAction]
      );
    } catch {}

    this.logger?.log({
      level: 'info',
      module: 'self-improvement',
      message: `Recorded anti-pattern ${record.id} for context "${record.context.slice(0, 60)}"`,
      metadata: { antiPatternId: record.id, context: record.context },
    });

    return record;
  }

  public findByContextAndMistake(context: string, mistake: string): AntiPatternRecord | null {
    const rows = this.persistence.query<AntiPatternRow>(
      `SELECT * FROM anti_patterns WHERE context = ? AND mistake = ? LIMIT 1`,
      [context, mistake]
    );
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  public getById(id: string): AntiPatternRecord | null {
    const rows = this.persistence.query<AntiPatternRow>(
      `SELECT * FROM anti_patterns WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  public search(queryText?: string, limit: number = 10): AntiPatternRecord[] {
    if (!queryText || queryText.trim().length === 0) {
      const rows = this.persistence.query<AntiPatternRow>(
        `SELECT * FROM anti_patterns ORDER BY confidence DESC, occurrences DESC LIMIT ?`,
        [limit]
      );
      return rows.map(this.mapRow);
    }

    // Try FTS5 query first
    try {
      const cleaned = queryText
        .replace(/['"*/]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .join(' OR ');

      if (cleaned) {
        const ftsRows = this.persistence.query<{ id: string }>(
          `SELECT id FROM anti_patterns_fts WHERE anti_patterns_fts MATCH ? LIMIT ?`,
          [cleaned, limit]
        );

        if (ftsRows.length > 0) {
          const ids = ftsRows.map((r) => `'${r.id}'`).join(',');
          const rows = this.persistence.query<AntiPatternRow>(
            `SELECT * FROM anti_patterns WHERE id IN (${ids}) ORDER BY confidence DESC`
          );
          return rows.map(this.mapRow);
        }
      }
    } catch {}

    // Fallback LIKE query
    const term = `%${queryText.trim()}%`;
    const rows = this.persistence.query<AntiPatternRow>(
      `SELECT * FROM anti_patterns 
       WHERE context LIKE ? OR mistake LIKE ? OR corrective_action LIKE ?
       ORDER BY confidence DESC, occurrences DESC LIMIT ?`,
      [term, term, term, limit]
    );
    return rows.map(this.mapRow);
  }

  public formatNegativeConstraints(queryText?: string, limit: number = 5): string {
    const patterns = this.search(queryText, limit);
    if (patterns.length === 0) {
      return '';
    }

    const lines: string[] = [
      `--- NEGATIVE CONSTRAINTS (Learned Anti-Patterns to Avoid) ---`,
    ];

    patterns.forEach((p, idx) => {
      lines.push(
        `${idx + 1}. [Context: ${p.context}]`,
        `   - Known Mistake: ${p.mistake}`,
        `   - Negative Consequence: ${p.consequence}`,
        `   - Mandatory Corrective Action: ${p.correctiveAction}`
      );
    });

    lines.push(`--- END NEGATIVE CONSTRAINTS ---`);
    return lines.join('\n');
  }

  private mapRow(row: AntiPatternRow): AntiPatternRecord {
    return {
      id: row.id,
      context: row.context,
      mistake: row.mistake,
      consequence: row.consequence,
      correctiveAction: row.corrective_action,
      confidence: row.confidence,
      occurrences: row.occurrences,
      sourceTaskId: row.source_task_id || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
