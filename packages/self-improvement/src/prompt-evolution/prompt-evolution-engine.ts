import { ulid } from 'ulidx';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { LLMRouter } from '@fuckclaw/llm-router';
import { PromptMutationProposal, ReasoningTrace } from '../types.js';

interface PromptMutationRow {
  id: string;
  target: string;
  version: number;
  original_prompt: string;
  proposed_prompt: string;
  rationale: string;
  failure_count: number;
  validation_passed: number;
  status: string;
  created_at: number;
  updated_at: number;
}

export class PromptEvolutionEngine {
  constructor(
    private persistence: IPersistenceLayer,
    private logger: IObservability,
    private llmRouter?: LLMRouter
  ) {}

  public async proposeImprovement(
    target: string,
    currentPrompt: string,
    failures: ReasoningTrace[] = []
  ): Promise<PromptMutationProposal> {
    const latestVersion = this.getLatestVersionNumber(target);
    const nextVersion = latestVersion + 1;
    const failureCount = failures.length;

    this.logger.log({
      level: 'info',
      module: 'self-improvement',
      message: `Generating prompt evolution proposal for target "${target}" (v${nextVersion}) from ${failureCount} failure trace(s)`,
      metadata: { target, nextVersion, failureCount },
    });

    const failureSummaries = failures.map((f, i) => {
      const stepMsg = f.steps.find((s) => !s.success)?.observation || f.error?.message || 'Failed';
      return `Failure ${i + 1}: Goal="${f.goal}", Error="${stepMsg}"`;
    }).join('\n');

    let proposedPrompt = currentPrompt;
    let rationale = `Refined prompt to address ${failureCount} recent failure modes.`;

    if (this.llmRouter) {
      try {
        const prompt = [
          `You are the Prompt Evolution engine of FuckClaw AI Self-Improvement (§23.3.3).`,
          `Analyze the target prompt and its observed failure cases, and synthesize an improved version that explicitly addresses these weaknesses without losing original capabilities.`,
          ``,
          `Target: ${target}`,
          `Current Prompt:`,
          `"""`,
          `${currentPrompt}`,
          `"""`,
          ``,
          `Observed Failures:`,
          `${failureSummaries || 'Recurring syntax or parameter validation errors'}`,
          ``,
          `Output ONLY a valid JSON object with:`,
          `{`,
          `  "proposedPrompt": "<complete updated prompt text>",`,
          `  "rationale": "<explanation of specific improvements and safeguards added>"`,
          `}`,
        ].join('\n');

        const response = await this.llmRouter.generate({
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 2000,
        });

        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.proposedPrompt && parsed.proposedPrompt.trim().length > 0) {
            proposedPrompt = parsed.proposedPrompt;
            rationale = parsed.rationale || rationale;
          }
        }
      } catch (err: any) {
        this.logger.log({
          level: 'warn',
          module: 'self-improvement',
          message: `LLM-driven prompt evolution fell back to rule-based enhancement: ${err.message}`,
        });
        proposedPrompt = `${currentPrompt}\n\n[REFINED v${nextVersion}]: Ensure strict parameter validation and robust error recovery.`;
      }
    } else {
      proposedPrompt = `${currentPrompt}\n\n[REFINED v${nextVersion}]: Ensure strict parameter validation and robust error recovery.`;
    }

    const validationPassed = proposedPrompt.trim().length > 0 && proposedPrompt !== currentPrompt;
    const id = ulid();
    const now = Date.now();

    const proposal: PromptMutationProposal = {
      id,
      target,
      version: nextVersion,
      originalPrompt: currentPrompt,
      proposedPrompt,
      rationale,
      failureCount,
      validationPassed,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    this.persistence.execute(
      `INSERT INTO prompt_mutations (id, target, version, original_prompt, proposed_prompt, rationale, failure_count, validation_passed, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        proposal.id,
        proposal.target,
        proposal.version,
        proposal.originalPrompt,
        proposal.proposedPrompt,
        proposal.rationale,
        proposal.failureCount,
        proposal.validationPassed ? 1 : 0,
        proposal.status,
        proposal.createdAt,
        proposal.updatedAt,
      ]
    );

    return proposal;
  }

  public getActivePrompt(target: string, fallbackPrompt: string): string {
    const rows = this.persistence.query<PromptMutationRow>(
      `SELECT * FROM prompt_mutations WHERE target = ? AND status = 'active' ORDER BY version DESC LIMIT 1`,
      [target]
    );

    if (rows[0] && rows[0].proposed_prompt) {
      return rows[0].proposed_prompt;
    }
    return fallbackPrompt;
  }

  public getProposal(id: string): PromptMutationProposal | null {
    const rows = this.persistence.query<PromptMutationRow>(
      `SELECT * FROM prompt_mutations WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  public listProposals(target?: string): PromptMutationProposal[] {
    if (target) {
      const rows = this.persistence.query<PromptMutationRow>(
        `SELECT * FROM prompt_mutations WHERE target = ? ORDER BY version DESC`,
        [target]
      );
      return rows.map(this.mapRow);
    }
    const rows = this.persistence.query<PromptMutationRow>(
      `SELECT * FROM prompt_mutations ORDER BY created_at DESC`
    );
    return rows.map(this.mapRow);
  }

  private getLatestVersionNumber(target: string): number {
    const rows = this.persistence.query<{ max_ver: number | null }>(
      `SELECT MAX(version) as max_ver FROM prompt_mutations WHERE target = ?`,
      [target]
    );
    return rows[0]?.max_ver ?? 0;
  }

  private mapRow(row: PromptMutationRow): PromptMutationProposal {
    return {
      id: row.id,
      target: row.target,
      version: row.version,
      originalPrompt: row.original_prompt,
      proposedPrompt: row.proposed_prompt,
      rationale: row.rationale,
      failureCount: row.failure_count,
      validationPassed: row.validation_passed === 1,
      status: row.status as any,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
