import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import { LLMRouter, ILLMProvider, LLMRequest, LLMResponse } from '@fuckclaw/llm-router';
import { SelfImprovementEngine, ReasoningTrace } from '../src/index.js';

class MockSelfImprovementLLMProvider implements ILLMProvider {
  name = 'mock-self-improvement-provider';

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const userPrompt = request.messages[request.messages.length - 1]?.content || '';

    // Failure analysis prompt
    if (userPrompt.includes('Failure Analysis engine')) {
      return {
        content: JSON.stringify({
          context: 'Docker build with Node.js on ARM64',
          mistake: 'Used standard node image without --platform flag',
          consequence: 'Build failed due to architecture mismatch',
          correctiveAction: 'Specify --platform=linux/amd64 or use multi-arch base image',
        }),
        usage: { promptTokens: 40, completionTokens: 30, totalTokens: 70 },
        costUsd: 0.0007,
      };
    }

    // Prompt evolution prompt
    if (userPrompt.includes('Prompt Evolution engine')) {
      return {
        content: JSON.stringify({
          proposedPrompt: 'You are a Coder agent. Ensure strict platform verification and validate Docker platform flags before executing builds.',
          rationale: 'Added mandatory platform flag check to eliminate ARM64 build failures.',
        }),
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
        costUsd: 0.0008,
      };
    }

    return {
      content: 'OK',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      costUsd: 0.0002,
    };
  }
}

describe('AI Self-Improvement Subsystem (@fuckclaw/self-improvement) §23', () => {
  let engine: SelfImprovementEngine;
  let persistence: PersistenceLayer;
  let eventBus: EventBus;
  let eventsEmitted: string[] = [];

  beforeEach(() => {
    eventsEmitted = [];
    const config = new ConfigManager({ workspace: { root: ':memory:' } });
    const logger = new Logger(config);
    persistence = new PersistenceLayer(':memory:', logger);
    eventBus = new EventBus(persistence, logger);

    const llmRouter = new LLMRouter(logger, eventBus);
    llmRouter.registerProvider(new MockSelfImprovementLLMProvider(), true);

    engine = new SelfImprovementEngine(persistence, logger, eventBus, llmRouter);

    eventBus.subscribe('self_improvement.*', async (evt) => {
      eventsEmitted.push(evt.type);
    });
  });

  it('analyzes a failed task trace and extracts a structured Anti-Pattern record (§23.3.2)', async () => {
    const failedTrace: ReasoningTrace = {
      taskId: 'task-fail-001',
      goal: 'Build Docker container on ARM64',
      success: false,
      error: {
        code: 'DOCKER_BUILD_FAILED',
        message: 'exec format error: binary cannot run on target platform',
      },
      steps: [
        {
          stepNumber: 1,
          action: 'docker build -t app:latest .',
          observation: 'Error: exec format error on amd64 binary',
          success: false,
        },
      ],
    };

    await engine.processTrace(failedTrace);

    const antiPatterns = await engine.getAntiPatterns('Docker build ARM64');
    expect(antiPatterns.length).toBeGreaterThan(0);

    const match = antiPatterns[0]!;
    expect(match.context).toContain('ARM64');
    expect(match.mistake).toContain('--platform');
    expect(match.correctiveAction).toContain('--platform=linux/amd64');
    expect(eventsEmitted).toContain('self_improvement.anti_pattern_extracted');
  });

  it('formats retrieved anti-patterns into negative prompt constraints (§23.3.2)', async () => {
    await engine.recordAntiPattern({
      context: 'Database migration on SQLite',
      mistake: 'Executed DROP TABLE without backing up foreign key references',
      consequence: 'Foreign key constraint violation during rollback',
      correctiveAction: 'Disable foreign keys temporarily or back up referenced tables first',
      confidence: 1.0,
    });

    const constraints = await engine.getNegativeConstraints('Database migration SQLite');
    expect(constraints).toContain('--- NEGATIVE CONSTRAINTS');
    expect(constraints).toContain('Known Mistake: Executed DROP TABLE');
    expect(constraints).toContain('Mandatory Corrective Action: Disable foreign keys');
  });

  it('proposes versioned prompt mutations addressing observed failure modes (§23.3.3)', async () => {
    const proposal = await engine.proposePromptImprovement('agent:coder');

    expect(proposal.target).toBe('agent:coder');
    expect(proposal.version).toBe(1);
    expect(proposal.proposedPrompt).toContain('platform verification');
    expect(proposal.rationale).toContain('eliminate ARM64 build failures');
    expect(proposal.status).toBe('active');

    // Verify persisted in SQLite
    const rows = persistence.query<{ id: string; target: string; version: number }>(
      'SELECT id, target, version FROM prompt_mutations WHERE target = ?',
      ['agent:coder']
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.version).toBe(1);
  });

  it('safely rolls back a prompt mutation upon performance degradation (§23.4)', async () => {
    const proposal = await engine.proposePromptImprovement('agent:coder');
    expect(proposal.status).toBe('active');

    await engine.rollback(proposal.id);

    const updated = persistence.query<{ status: string }>(
      'SELECT status FROM prompt_mutations WHERE id = ?',
      [proposal.id]
    );
    expect(updated[0]!.status).toBe('rolled_back');
    expect(eventsEmitted).toContain('self_improvement.rollback');
  });

  it('runs a complete self-improvement analysis report cycle (§23.5)', async () => {
    const report = await engine.runAnalysis();
    expect(report.id).toBeDefined();
    expect(report.timestamp).toBeGreaterThan(0);
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(eventsEmitted).toContain('self_improvement.analysis_completed');
  });
});
