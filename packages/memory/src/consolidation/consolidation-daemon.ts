import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { EpisodicStore } from '../episodic/episodic-store.js';
import { SemanticStore } from '../semantic/semantic-store.js';
import { ProceduralStore } from '../procedural/procedural-store.js';
import { EpisodicMemoryRecord } from '../types.js';
import { generateSimpleEmbedding } from '../decay/ebbinghaus-decay.js';

export interface ConsolidationReport {
  timestamp: number;
  episodesProcessed: number;
  factsExtracted: number;
  proceduresExtracted: number;
}

/**
 * Consolidation Daemon (§6.6.1)
 * Periodic / idle background worker that digests unconsolidated episodic traces
 * into generalized semantic facts and procedural workflows.
 */
export class ConsolidationDaemon {
  constructor(
    private episodicStore: EpisodicStore,
    private semanticStore: SemanticStore,
    private proceduralStore: ProceduralStore,
    private logger?: IObservability,
    private eventBus?: IEventBus
  ) {}

  async consolidate(): Promise<ConsolidationReport> {
    const start = Date.now();
    const unconsolidated: EpisodicMemoryRecord[] = await this.episodicStore.getUnconsolidated(50);

    let factsExtracted = 0;
    let proceduresExtracted = 0;

    if (unconsolidated.length === 0) {
      return {
        timestamp: start,
        episodesProcessed: 0,
        factsExtracted: 0,
        proceduresExtracted: 0,
      };
    }

    this.logger?.log({
      level: 'info',
      module: 'memory.consolidation',
      message: `Starting memory consolidation cycle for ${unconsolidated.length} episode(s)...`,
      metadata: { episodeCount: unconsolidated.length },
    });

    // Group episodes by taskId or sessionId
    const grouped = new Map<string, EpisodicMemoryRecord[]>();
    for (const ep of unconsolidated) {
      const groupKey = ep.taskId || ep.sessionId || 'default';
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, []);
      }
      grouped.get(groupKey)!.push(ep);
    }

    for (const [groupKey, episodes] of grouped.entries()) {
      // 1. Check for procedural tool execution sequence
      const toolEpisodes = episodes.filter((e: EpisodicMemoryRecord) => e.toolCall);
      if (toolEpisodes.length >= 2) {
        const procedureName = `workflow_${groupKey.replace(/[^\w]/g, '_')}_${Date.now()}`;
        const steps = toolEpisodes.map((e: EpisodicMemoryRecord, idx: number) => ({
          order: idx + 1,
          actionType: 'tool_call' as const,
          toolName: e.toolCall!.toolName,
          paramTemplate: e.toolCall!.inputParams,
          expectedOutcome: e.summary,
        }));

        await this.proceduralStore.recordProcedure({
          name: procedureName,
          intentSignature: `Workflow for ${toolEpisodes[0]!.summary}`,
          preconditions: [`Environment configured for ${toolEpisodes[0]!.toolCall!.toolName}`],
          executionGraph: steps,
        });
        proceduresExtracted++;
      }

      // 2. Extract semantic facts from high-importance episodes
      for (const ep of episodes) {
        if (ep.importanceScore >= 0.6 && ep.summary.length > 10) {
          await this.semanticStore.assertFact({
            subject: ep.taskId ? `task.${ep.taskId}` : `session.${ep.sessionId}`,
            predicate: 'resulted_in',
            object: ep.summary,
            statement: ep.summary,
            confidence: Math.min(1.0, ep.importanceScore),
            sourceEpisodicIds: [ep.id],
            validFrom: ep.timestamp,
            validUntil: null,
            embedding: generateSimpleEmbedding(ep.summary),
          });
          factsExtracted++;
        }
      }

      // 3. Mark processed episodes as consolidated
      const epIds = episodes.map((e: EpisodicMemoryRecord) => e.id);
      await this.episodicStore.markConsolidated(epIds);
    }

    const report: ConsolidationReport = {
      timestamp: Date.now(),
      episodesProcessed: unconsolidated.length,
      factsExtracted,
      proceduresExtracted,
    };

    if (this.eventBus) {
      await this.eventBus.emit('memory.consolidation.completed', { ...report });
    }

    this.logger?.log({
      level: 'info',
      module: 'memory.consolidation',
      message: `Memory consolidation complete: processed ${unconsolidated.length} episode(s), extracted ${factsExtracted} fact(s), ${proceduresExtracted} procedure(s)`,
      metadata: { ...report },
    });

    return report;
  }
}
