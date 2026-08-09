/**
 * Milestone 8 Consolidated Demonstration
 * Covers:
 * - §15 Multi-Agent Architecture (Supervisor/Worker delegation, specialized roles, tool boundaries, parallel fanout)
 * - §23 AI Self-Improvement (Failure trace analysis, anti-pattern extraction, negative constraint prompt injection, prompt evolution, rollback)
 */
import { createFuckClawRuntime } from '../packages/cli/dist/index.js';

class Milestone8MockProvider {
  name = 'milestone8-mock-provider';

  async generate(req) {
    const lastMsg = req.messages[req.messages.length - 1]?.content || '';
    const sysPrompt = req.messages.find((m) => m.role === 'system')?.content || '';

    // Multi-Agent Coder
    if (sysPrompt.includes('Coder agent')) {
      if (lastMsg.includes('Observation from tool "filesystem"')) {
        return {
          content: 'I have created and verified src/auth/jwt.ts with token signing and verification logic.',
          provider: 'mock',
          model: 'mock-coder',
          usage: { promptTokens: 40, completionTokens: 20, totalTokens: 60 },
          costUsd: 0.0006,
        };
      }
      return {
        content: '```tool_call {"tool": "filesystem", "args": {"action": "write", "path": "workspace/jwt.ts", "content": "export function signToken(payload: any) { return \'signed-token\'; }"}} ```',
        provider: 'mock',
        model: 'mock-coder',
        usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        costUsd: 0.0005,
      };
    }

    // Multi-Agent Reviewer
    if (sysPrompt.includes('Reviewer agent')) {
      return {
        content: 'Review Approved: Token signing routine is clean and properly typed.',
        provider: 'mock',
        model: 'mock-reviewer',
        usage: { promptTokens: 30, completionTokens: 15, totalTokens: 45 },
        costUsd: 0.00045,
      };
    }

    // Self-Improvement Failure Analysis
    if (lastMsg.includes('Failure Analysis engine')) {
      return {
        content: JSON.stringify({
          context: 'JWT secret key generation without high entropy',
          mistake: 'Used Math.random() instead of crypto.randomBytes() for JWT secret generation',
          consequence: 'Insecure cryptographic secret vulnerable to brute-force predictability',
          correctiveAction: 'Always use crypto.randomBytes(32).toString(\'hex\') for cryptographic key generation',
        }),
        provider: 'mock',
        model: 'mock-analyst',
        usage: { promptTokens: 45, completionTokens: 35, totalTokens: 80 },
        costUsd: 0.0008,
      };
    }

    // Self-Improvement Prompt Evolution
    if (lastMsg.includes('Prompt Evolution engine')) {
      return {
        content: JSON.stringify({
          proposedPrompt: 'You are a Security-Hardened Coder agent. Never use Math.random() for tokens or secrets; strictly enforce crypto.randomBytes() for cryptographic operations.',
          rationale: 'Mandate crypto module for all cryptographic entropy generation.',
        }),
        provider: 'mock',
        model: 'mock-evolver',
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
        costUsd: 0.0008,
      };
    }

    return {
      content: 'Milestone 8 operation completed.',
      provider: 'mock',
      model: 'mock-standard',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      costUsd: 0.0002,
    };
  }
}

async function runMilestone8Demo() {
  console.log('\n================================================================');
  console.log('  FuckClaw Milestone 8 — Multi-Agent & AI Self-Improvement Demo');
  console.log('================================================================\n');

  const runtime = await createFuckClawRuntime(
    { workspace: { root: ':memory:' } },
    new Milestone8MockProvider()
  );

  try {
    console.log('>>> PART 1: Multi-Agent Architecture (§15)');
    console.log('--------------------------------------------------');

    console.log('1.1 Delegating implementation to specialized Coder agent...');
    const coderRes = await runtime.multiAgent.delegate({
      parentTaskId: 'task-auth-jwt',
      agentType: 'coder',
      task: 'Implement JWT signing utility in workspace/jwt.ts',
      context: { files: ['workspace/jwt.ts'] },
      budget: { maxTokens: 10000 },
      timeoutMs: 15000,
    });
    console.log(`  ✓ Coder Output: "${coderRes.output}"`);

    console.log('\n1.2 Delegating code review to specialized Reviewer agent...');
    const reviewerRes = await runtime.multiAgent.delegate({
      parentTaskId: 'task-auth-jwt',
      agentType: 'reviewer',
      task: 'Review JWT signing utility in workspace/jwt.ts',
      context: { files: ['workspace/jwt.ts'] },
      budget: { maxTokens: 5000 },
      timeoutMs: 15000,
    });
    console.log(`  ✓ Reviewer Output: "${reviewerRes.output}"`);

    console.log('\n>>> PART 2: AI Self-Improvement Loop (§23)');
    console.log('--------------------------------------------------');

    console.log('2.1 Ingesting insecure secret generation failure trace...');
    await runtime.selfImprovement.processTrace({
      taskId: 'task-sec-jwt-fail',
      goal: 'Generate cryptographic JWT secret',
      success: false,
      error: {
        code: 'INSECURE_ENTROPY',
        message: 'Security audit failed: Math.random() produces predictable entropy',
      },
      steps: [
        {
          stepNumber: 1,
          action: 'const secret = Math.random().toString(36);',
          observation: 'Security rule violation: Math.random() is cryptographically insecure',
          success: false,
        },
      ],
    });

    console.log('\n2.2 Querying extracted Anti-Pattern records from SQLite...');
    const antiPatterns = await runtime.selfImprovement.getAntiPatterns('JWT secret key generation');
    antiPatterns.forEach((ap) => {
      console.log(`  ✓ Learned Anti-Pattern:`);
      console.log(`    - Context: "${ap.context}"`);
      console.log(`    - Mistake: "${ap.mistake}"`);
      console.log(`    - Corrective Action: "${ap.correctiveAction}"`);
    });

    console.log('\n2.3 Formatting negative constraints for Kernel prompt injection...');
    const constraints = await runtime.selfImprovement.getNegativeConstraints('JWT secret key');
    console.log(`  ✓ Negative Constraints:\n${constraints}`);

    console.log('\n2.4 Proposing prompt mutation via Prompt Evolution Engine...');
    const proposal = await runtime.selfImprovement.proposePromptImprovement('agent:coder');
    console.log(`  ✓ Proposal ${proposal.id} (v${proposal.version}): "${proposal.proposedPrompt}"`);

    console.log('\n2.5 Testing safety rollback (§23.4)...');
    await runtime.selfImprovement.rollback(proposal.id);
    const rolledBack = runtime.persistence.query(
      'SELECT id, status FROM prompt_mutations WHERE id = ?',
      [proposal.id]
    );
    console.log(`  ✓ Mutation ${proposal.id} status in SQLite: "${rolledBack[0]?.status}"`);

    console.log('\n================================================================');
    console.log('  ✅ Milestone 8 Demonstration Completed Successfully');
    console.log('================================================================\n');
  } finally {
    await runtime.shutdown();
  }
}

runMilestone8Demo().catch((err) => {
  console.error('Milestone 8 demo failed:', err);
  process.exit(1);
});
