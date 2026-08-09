import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { ulid } from 'ulidx';

export interface ProceduralStep {
  order: number;
  actionType: 'tool_call' | 'query' | 'verify';
  toolName?: string;
  paramTemplate?: Record<string, unknown>;
  expectedOutcome: string;
  fallbackStepOnFailure?: number;
}

export interface ProceduralMemoryRecord {
  id: string;
  name: string;
  intentSignature: string;
  preconditions: string[];
  executionGraph: ProceduralStep[];
  successRate: number;
  executionCount: number;
  lastExecutedAt: number;
  embedding?: number[];
  createdAt: number;
}

export interface ProceduralRecordInput {
  name: string;
  intentSignature: string;
  preconditions?: string[];
  executionGraph: ProceduralStep[];
}

/**
 * Procedural Store (§6.4.4)
 * Stores workflows, tool calling chains, and debugging playbooks in SQLite with FTS5 indexing.
 */
export class ProceduralStore {
  private cache: Map<string, ProceduralMemoryRecord> = new Map();

  constructor(
    private persistence: IPersistenceLayer,
    private logger: IObservability
  ) {}

  async recordProcedure(input: ProceduralRecordInput): Promise<string> {
    const id = ulid();
    const now = Date.now();
    const preconditions = input.preconditions ?? [];

    const record: ProceduralMemoryRecord = {
      id,
      name: input.name,
      intentSignature: input.intentSignature,
      preconditions,
      executionGraph: input.executionGraph,
      successRate: 1.0,
      executionCount: 0,
      lastExecutedAt: now,
      createdAt: now,
    };

    // 1. Insert or replace in SQLite
    this.persistence.execute(
      `INSERT OR REPLACE INTO procedural_memories (
        id, name, intent_signature, preconditions_json, execution_graph_json,
        success_rate, execution_count, last_executed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.name,
        record.intentSignature,
        JSON.stringify(record.preconditions),
        JSON.stringify(record.executionGraph),
        record.successRate,
        record.executionCount,
        record.lastExecutedAt,
        record.createdAt,
      ]
    );

    // 2. FTS5 Indexing
    try {
      this.persistence.execute(
        `INSERT INTO procedural_fts (id, name, intent_signature) VALUES (?, ?, ?)`,
        [record.id, record.name, record.intentSignature]
      );
    } catch {}

    this.cache.set(record.id, record);

    this.logger.log({
      level: 'info',
      module: 'memory.procedural',
      message: `Recorded procedural workflow "${record.name}" (${record.id})`,
      metadata: { id: record.id, name: record.name, steps: record.executionGraph.length },
    });

    return record.id;
  }

  async getProcedure(id: string): Promise<ProceduralMemoryRecord | null> {
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    const rows = this.persistence.query<{
      id: string;
      name: string;
      intent_signature: string;
      preconditions_json: string;
      execution_graph_json: string;
      success_rate: number;
      execution_count: number;
      last_executed_at: number;
      created_at: number;
    }>('SELECT * FROM procedural_memories WHERE id = ?', [id]);

    if (rows.length === 0) {
      return null;
    }

    const r = rows[0]!;
    const record: ProceduralMemoryRecord = {
      id: r.id,
      name: r.name,
      intentSignature: r.intent_signature,
      preconditions: JSON.parse(r.preconditions_json || '[]'),
      executionGraph: JSON.parse(r.execution_graph_json || '[]'),
      successRate: r.success_rate,
      executionCount: r.execution_count,
      lastExecutedAt: r.last_executed_at,
      createdAt: r.created_at,
    };

    this.cache.set(record.id, record);
    return record;
  }

  async queryProcedural(intent: string, limit: number = 10): Promise<ProceduralMemoryRecord[]> {
    const cleanQuery = intent.replace(/[^\w\s]/g, ' ').trim();
    if (!cleanQuery) {
      const allRows = this.persistence.query<{
        id: string;
        name: string;
        intent_signature: string;
        preconditions_json: string;
        execution_graph_json: string;
        success_rate: number;
        execution_count: number;
        last_executed_at: number;
        created_at: number;
      }>('SELECT * FROM procedural_memories ORDER BY success_rate DESC, execution_count DESC LIMIT ?', [limit]);

      return allRows.map((r) => ({
        id: r.id,
        name: r.name,
        intentSignature: r.intent_signature,
        preconditions: JSON.parse(r.preconditions_json || '[]'),
        executionGraph: JSON.parse(r.execution_graph_json || '[]'),
        successRate: r.success_rate,
        executionCount: r.execution_count,
        lastExecutedAt: r.last_executed_at,
        createdAt: r.created_at,
      }));
    }

    // Try FTS search first
    try {
      const ftsMatches = this.persistence.query<{ id: string }>(
        `SELECT id FROM procedural_fts WHERE procedural_fts MATCH ? LIMIT ?`,
        [cleanQuery, limit]
      );

      if (ftsMatches.length > 0) {
        const results: ProceduralMemoryRecord[] = [];
        for (const match of ftsMatches) {
          const proc = await this.getProcedure(match.id);
          if (proc) results.push(proc);
        }
        return results;
      }
    } catch {}

    // Fallback to LIKE matching
    const likePattern = `%${cleanQuery}%`;
    const rows = this.persistence.query<{
      id: string;
      name: string;
      intent_signature: string;
      preconditions_json: string;
      execution_graph_json: string;
      success_rate: number;
      execution_count: number;
      last_executed_at: number;
      created_at: number;
    }>(
      `SELECT * FROM procedural_memories WHERE name LIKE ? OR intent_signature LIKE ? ORDER BY success_rate DESC LIMIT ?`,
      [likePattern, likePattern, limit]
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      intentSignature: r.intent_signature,
      preconditions: JSON.parse(r.preconditions_json || '[]'),
      executionGraph: JSON.parse(r.execution_graph_json || '[]'),
      successRate: r.success_rate,
      executionCount: r.execution_count,
      lastExecutedAt: r.last_executed_at,
      createdAt: r.created_at,
    }));
  }

  async recordOutcome(procedureId: string, success: boolean): Promise<void> {
    const procedure = await this.getProcedure(procedureId);
    if (!procedure) return;

    const newExecutionCount = procedure.executionCount + 1;
    const oldSuccessTotal = procedure.successRate * procedure.executionCount;
    const newSuccessTotal = oldSuccessTotal + (success ? 1 : 0);
    const newSuccessRate = Number((newSuccessTotal / newExecutionCount).toFixed(4));
    const now = Date.now();

    this.persistence.execute(
      `UPDATE procedural_memories SET success_rate = ?, execution_count = ?, last_executed_at = ? WHERE id = ?`,
      [newSuccessRate, newExecutionCount, now, procedureId]
    );

    procedure.successRate = newSuccessRate;
    procedure.executionCount = newExecutionCount;
    procedure.lastExecutedAt = now;
    this.cache.set(procedureId, procedure);
  }
}
