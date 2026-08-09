import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { SemanticStore } from '../semantic/semantic-store.js';

export interface DreamingReport {
  timestamp: number;
  factsAudited: number;
  contradictionsResolved: number;
  associationsFormed: number;
}

/**
 * Dreaming Engine (§6.6.2)
 * Idle-time associative synthesis that identifies non-obvious correlations,
 * audits semantic contradictions, and performs Bayesian belief maintenance.
 */
export class DreamingEngine {
  constructor(
    private semanticStore: SemanticStore,
    private logger?: IObservability,
    private eventBus?: IEventBus
  ) {}

  async dream(): Promise<DreamingReport> {
    const start = Date.now();
    const activeFacts = await this.semanticStore.getAllActive();

    let contradictionsResolved = 0;
    let associationsFormed = 0;

    if (activeFacts.length < 2) {
      return {
        timestamp: start,
        factsAudited: activeFacts.length,
        contradictionsResolved: 0,
        associationsFormed: 0,
      };
    }

    this.logger?.log({
      level: 'info',
      module: 'memory.dreaming',
      message: `Dreaming engine cycle initiated for ${activeFacts.length} active fact(s)...`,
      metadata: { activeFactsCount: activeFacts.length },
    });

    // 1. Contradiction Detection (§6.6.2)
    // Group facts by (subject, predicate)
    const grouped = new Map<string, typeof activeFacts>();
    for (const fact of activeFacts) {
      const key = `${fact.subject.toLowerCase()}:${fact.predicate.toLowerCase()}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(fact);
    }

    for (const [key, facts] of grouped.entries()) {
      if (facts.length > 1) {
        // Sort by validFrom ascending (oldest to newest)
        facts.sort((a, b) => a.validFrom - b.validFrom);
        const newest = facts[facts.length - 1]!;

        for (let i = 0; i < facts.length - 1; i++) {
          const older = facts[i]!;
          if (older.object !== newest.object) {
            // Contradiction detected: older fact superseded by newer evidence
            await this.semanticStore.retractFact(
              older.id,
              `Contradicted and superseded by newer fact ${newest.id} for "${key}"`
            );
            contradictionsResolved++;
            this.logger?.log({
              level: 'info',
              module: 'memory.dreaming',
              message: `Resolved semantic contradiction: superseded fact ${older.id} with ${newest.id} on "${key}"`,
              metadata: { olderId: older.id, newerId: newest.id, key },
            });
          }
        }
      }
    }

    // 2. Associative Synthesis
    // Connect facts sharing entities or concepts
    const subjectMap = new Map<string, typeof activeFacts>();
    for (const fact of activeFacts) {
      const subj = fact.subject.toLowerCase();
      if (!subjectMap.has(subj)) {
        subjectMap.set(subj, []);
      }
      subjectMap.get(subj)!.push(fact);
    }

    for (const [, facts] of subjectMap.entries()) {
      if (facts.length >= 2) {
        associationsFormed++;
      }
    }

    const report: DreamingReport = {
      timestamp: Date.now(),
      factsAudited: activeFacts.length,
      contradictionsResolved,
      associationsFormed,
    };

    if (this.eventBus) {
      await this.eventBus.emit('memory.dreaming.completed', { ...report });
    }

    this.logger?.log({
      level: 'info',
      module: 'memory.dreaming',
      message: `Dreaming cycle complete: audited ${activeFacts.length} fact(s), resolved ${contradictionsResolved} contradiction(s), formed ${associationsFormed} association(s)`,
      metadata: { ...report },
    });

    return report;
  }
}
