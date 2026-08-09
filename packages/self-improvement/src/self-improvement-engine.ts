import { ulid } from 'ulidx';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { LLMRouter } from '@fuckclaw/llm-router';
import { ISkillEngine } from '@fuckclaw/skills';
import {
  ISelfImprovementEngine,
  AntiPatternRecord,
  PromptMutationProposal,
  ReasoningTrace,
  SelfImprovementReport,
} from './types.js';
import { AntiPatternStore } from './anti-patterns/anti-pattern-store.js';
import { FailureAnalyzer } from './anti-patterns/failure-analyzer.js';
import { PromptEvolutionEngine } from './prompt-evolution/prompt-evolution-engine.js';
import { RollbackManager } from './rollback/rollback-manager.js';

export class SelfImprovementEngine implements ISelfImprovementEngine {
  private antiPatternStore: AntiPatternStore;
  private failureAnalyzer: FailureAnalyzer;
  private promptEvolution: PromptEvolutionEngine;
  private rollbackManager: RollbackManager;
  private recentTraces: ReasoningTrace[] = [];

  constructor(
    private persistence: IPersistenceLayer,
    private logger: IObservability,
    private eventBus: IEventBus,
    llmRouter?: LLMRouter,
    skillEngine?: ISkillEngine
  ) {
    this.antiPatternStore = new AntiPatternStore(persistence, logger);
    this.failureAnalyzer = new FailureAnalyzer(this.antiPatternStore, logger, llmRouter);
    this.promptEvolution = new PromptEvolutionEngine(persistence, logger, llmRouter);
    this.rollbackManager = new RollbackManager(persistence, logger, eventBus, skillEngine);
  }

  public async processTrace(trace: ReasoningTrace): Promise<void> {
    this.recentTraces.push(trace);
    if (this.recentTraces.length > 50) {
      this.recentTraces.shift();
    }

    if (!trace.success) {
      const antiPattern = await this.failureAnalyzer.analyzeTrace(trace);
      if (antiPattern) {
        await this.eventBus.emit('self_improvement.anti_pattern_extracted', {
          antiPatternId: antiPattern.id,
          context: antiPattern.context,
          mistake: antiPattern.mistake,
          correctiveAction: antiPattern.correctiveAction,
        });
      }
    }
  }

  public async runAnalysis(): Promise<SelfImprovementReport> {
    const reportId = ulid();
    const startTime = Date.now();

    this.logger.log({
      level: 'info',
      module: 'self-improvement',
      message: `Running Self-Improvement Analysis cycle ${reportId}...`,
    });

    const failedTraces = this.recentTraces.filter((t) => !t.success);
    const antiPatterns = this.antiPatternStore.search('', 20);

    const promptProposals: PromptMutationProposal[] = [];
    const recommendations: string[] = [];

    // Group failed traces by domain/goal prefix
    if (failedTraces.length > 0) {
      recommendations.push(
        `Analyzed ${failedTraces.length} recent failure trace(s). Extracted ${antiPatterns.length} anti-patterns.`
      );
    } else {
      recommendations.push('All recent task execution traces completed successfully.');
    }

    const report: SelfImprovementReport = {
      id: reportId,
      timestamp: startTime,
      tracesAnalyzed: this.recentTraces.length,
      antiPatternsExtracted: antiPatterns.length,
      promptProposals,
      skillsExtracted: [],
      recommendations,
    };

    await this.eventBus.emit('self_improvement.analysis_completed', {
      reportId: report.id,
      tracesAnalyzed: report.tracesAnalyzed,
      antiPatternsExtracted: report.antiPatternsExtracted,
    });

    return report;
  }

  public async proposePromptImprovement(
    target: string,
    failures?: ReasoningTrace[]
  ): Promise<PromptMutationProposal> {
    const relevantFailures = failures || this.recentTraces.filter((t) => !t.success);
    const currentPrompt = `Standard operational prompt for target: ${target}`;
    return this.promptEvolution.proposeImprovement(target, currentPrompt, relevantFailures);
  }

  public async applyPromptImprovement(proposalId: string): Promise<void> {
    const proposal = this.promptEvolution.getProposal(proposalId);
    if (!proposal) {
      throw new Error(`Prompt mutation proposal ${proposalId} not found`);
    }

    this.persistence.execute(
      `UPDATE prompt_mutations SET status = 'active', updated_at = ? WHERE id = ?`,
      [Date.now(), proposalId]
    );

    this.logger.log({
      level: 'info',
      module: 'self-improvement',
      message: `Applied prompt mutation ${proposalId} for target "${proposal.target}" (v${proposal.version})`,
    });
  }

  public async rollback(changeId: string): Promise<void> {
    return this.rollbackManager.rollbackChange(changeId);
  }

  public async getAntiPatterns(contextQuery?: string): Promise<AntiPatternRecord[]> {
    return this.antiPatternStore.search(contextQuery);
  }

  public async getNegativeConstraints(contextQuery?: string): Promise<string> {
    return this.antiPatternStore.formatNegativeConstraints(contextQuery);
  }

  public async recordAntiPattern(
    antiPattern: Omit<AntiPatternRecord, 'id' | 'createdAt' | 'updatedAt' | 'occurrences'> & {
      occurrences?: number;
      id?: string;
    }
  ): Promise<AntiPatternRecord> {
    return this.antiPatternStore.record(antiPattern);
  }
}
