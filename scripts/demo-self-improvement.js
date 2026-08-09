/**
 * Demo B: AI Self-Improvement Loop (§23)
 * Proves:
 * 1. A task fails with an execution error
 * 2. Failure analyzer extracts structured Anti-Pattern record
 * 3. Anti-pattern is persisted in SQLite & formatted into negative constraints
 * 4. Prompt evolution engine drafts versioned prompt mutation proposal
 * 5. Changes are persisted, traceable, and safely reversible via rollback
 */
import { createFuckClawRuntime } from '../packages/cli/dist/index.js';

class SelfImprovementMockProvider {
  name = 'self-improvement-demo-provider';

  async generate(req) {
    const userPrompt = req.messages[req.messages.length - 1]?.content || '';

    // Failure analysis prompt
    if (userPrompt.includes('Failure Analysis engine')) {
      return {
        content: JSON.stringify({
          context: 'SQLite table migration and column dropping',
          mistake: 'Directly issued DROP COLUMN on table with foreign key references without table recreation',
          consequence: 'SQL execution failed with SQLite foreign key constraint violation',
          correctiveAction: 'Use 12-step table recreation pattern: create temp table, copy data, drop old table, rename temp table',
        }),
        provider: 'mock',
        model: 'mock-analyst',
        usage: { promptTokens: 45, completionTokens: 35, totalTokens: 80 },
        costUsd: 0.0008,
      };
    }

    // Prompt evolution prompt
    if (userPrompt.includes('Prompt Evolution engine')) {
      return {
        content: JSON.stringify({
          proposedPrompt: 'You are a Database Engineer agent. When altering SQLite schemas, never issue DROP COLUMN directly on foreign-keyed tables; always use the 12-step table recreation migration pattern.',
          rationale: 'Incorporate 12-step table recreation rule to prevent foreign key schema corruption.',
        }),
        provider: 'mock',
        model: 'mock-evolver',
        usage: { promptTokens: 50, completionTokens: 35, totalTokens: 85 },
        costUsd: 0.00085,
      };
    }

    return {
      content: 'Self-improvement cycle step complete.',
      provider: 'mock',
      model: 'mock-standard',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      costUsd: 0.0002,
    };
  }
}

async function runDemoB() {
  console.log('\n======================================================');
  console.log('  FuckClaw §23 AI Self-Improvement Demonstration');
  console.log('======================================================\n');

  const runtime = await createFuckClawRuntime(
    { workspace: { root: ':memory:' } },
    new SelfImprovementMockProvider()
  );

  try {
    console.log('[1/5] Ingesting failed task execution trace...');
    const failedTrace = {
      taskId: 'task-db-mig-404',
      goal: 'Migrate users table in SQLite database',
      success: false,
      error: {
        code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
        message: 'FOREIGN KEY constraint failed: cannot drop column referenced by orders table',
      },
      steps: [
        {
          stepNumber: 1,
          action: 'ALTER TABLE users DROP COLUMN legacy_id;',
          observation: 'Error: FOREIGN KEY constraint failed',
          success: false,
        },
      ],
    };

    await runtime.selfImprovement.processTrace(failedTrace);

    console.log('\n[2/5] Querying extracted Anti-Pattern records from SQLite...');
    const antiPatterns = await runtime.selfImprovement.getAntiPatterns('SQLite table migration');
    console.log(`  ✓ Found ${antiPatterns.length} anti-pattern(s):`);
    antiPatterns.forEach((ap) => {
      console.log(`    - ID: ${ap.id}`);
      console.log(`      Context: "${ap.context}"`);
      console.log(`      Mistake: "${ap.mistake}"`);
      console.log(`      Corrective Action: "${ap.correctiveAction}"`);
      console.log(`      Confidence: ${ap.confidence}, Occurrences: ${ap.occurrences}`);
    });

    console.log('\n[3/5] Formatting negative constraints for subsequent prompt injection...');
    const constraints = await runtime.selfImprovement.getNegativeConstraints('SQLite table migration');
    console.log(`  ✓ Injected Negative Constraints:\n${constraints}`);

    console.log('\n[4/5] Triggering Prompt Evolution engine proposal...');
    const proposal = await runtime.selfImprovement.proposePromptImprovement('agent:database_engineer', [failedTrace]);
    console.log(`  ✓ Proposal ${proposal.id} (Version ${proposal.version}, Status: ${proposal.status}):`);
    console.log(`    Rationale: "${proposal.rationale}"`);
    console.log(`    Proposed Prompt: "${proposal.proposedPrompt}"`);

    console.log('\n[5/5] Testing safeguard rollback functionality (§23.4)...');
    await runtime.selfImprovement.rollback(proposal.id);
    const rolledBack = runtime.persistence.query(
      'SELECT id, target, version, status FROM prompt_mutations WHERE id = ?',
      [proposal.id]
    );
    console.log(`  ✓ Mutation ${proposal.id} status updated in SQLite: "${rolledBack[0]?.status}"`);

    console.log('\n✅ Demo B (AI Self-Improvement) completed successfully.\n');
  } finally {
    await runtime.shutdown();
  }
}

runDemoB().catch((err) => {
  console.error('Demo B failed:', err);
  process.exit(1);
});
