/**
 * Demo A: Multi-Agent Delegation (§15)
 * Proves:
 * 1. Supervisor assigns a task to a specialized Coder agent
 * 2. Coder worker executes with focused context & allowed tools
 * 3. Supervisor assigns review task to Reviewer agent
 * 4. Results flow back to supervisor and shared context remains consistent
 */
import { createFuckClawRuntime } from '../packages/cli/dist/index.js';

class MultiAgentMockProvider {
  name = 'multi-agent-demo-provider';

  async generate(req) {
    const lastMsg = req.messages[req.messages.length - 1]?.content || '';
    const sysPrompt = req.messages.find((m) => m.role === 'system')?.content || '';

    // Coder agent
    if (sysPrompt.includes('Coder agent')) {
      if (lastMsg.includes('Observation from tool "filesystem"')) {
        return {
          content: 'I have created and verified src/routes/users.ts with complete pagination support. All unit tests pass.',
          provider: 'mock',
          model: 'mock-coder',
          usage: { promptTokens: 40, completionTokens: 25, totalTokens: 65 },
          costUsd: 0.00065,
        };
      }
      return {
        content: '```tool_call {"tool": "filesystem", "args": {"action": "write", "path": "workspace/users-api.ts", "content": "export function getUsers(page = 1, limit = 20) { return { page, limit, data: [] }; }"}} ```',
        provider: 'mock',
        model: 'mock-coder',
        usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        costUsd: 0.0005,
      };
    }

    // Reviewer agent
    if (sysPrompt.includes('Reviewer agent')) {
      return {
        content: 'Code Review Approved: The pagination implementation adheres to API conventions, provides sensible defaults (page=1, limit=20), and includes type definitions.',
        provider: 'mock',
        model: 'mock-reviewer',
        usage: { promptTokens: 35, completionTokens: 20, totalTokens: 55 },
        costUsd: 0.00055,
      };
    }

    return {
      content: 'Multi-agent coordination step completed.',
      provider: 'mock',
      model: 'mock-standard',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      costUsd: 0.0002,
    };
  }
}

async function runDemoA() {
  console.log('\n======================================================');
  console.log('  FuckClaw §15 Multi-Agent Delegation Demonstration');
  console.log('======================================================\n');

  const runtime = await createFuckClawRuntime(
    { workspace: { root: ':memory:' } },
    new MultiAgentMockProvider()
  );

  try {
    console.log('[1/4] Inspecting registered specialized agent roles...');
    const specs = [
      runtime.multiAgent.getAgentSpec('supervisor'),
      runtime.multiAgent.getAgentSpec('coder'),
      runtime.multiAgent.getAgentSpec('reviewer'),
      runtime.multiAgent.getAgentSpec('researcher'),
    ];
    specs.forEach((s) => {
      console.log(`  ✓ Role: "${s.type}" | Allowed Tools: ${Array.isArray(s.allowedTools) ? s.allowedTools.join(', ') : s.allowedTools} | Max Instances: ${s.maxInstances}`);
    });

    console.log('\n[2/4] Supervisor delegating implementation to Coder agent...');
    const coderResult = await runtime.multiAgent.delegate({
      parentTaskId: 'task-feat-users-api',
      agentType: 'coder',
      task: 'Implement pagination endpoint in workspace/users-api.ts with page & limit parameters',
      context: { files: ['workspace/users-api.ts'] },
      budget: { maxTokens: 10000 },
      timeoutMs: 15000,
    });

    console.log(`  ✓ Coder Result (Success: ${coderResult.success}, Tokens: ${coderResult.tokensUsed}, Duration: ${coderResult.durationMs}ms):`);
    console.log(`    "${coderResult.output}"`);

    console.log('\n[3/4] Supervisor delegating quality review to Reviewer agent...');
    const reviewerResult = await runtime.multiAgent.delegate({
      parentTaskId: 'task-feat-users-api',
      agentType: 'reviewer',
      task: 'Review implementation of workspace/users-api.ts against code quality standards',
      context: { files: ['workspace/users-api.ts'] },
      budget: { maxTokens: 5000 },
      timeoutMs: 15000,
    });

    console.log(`  ✓ Reviewer Result (Success: ${reviewerResult.success}, Tokens: ${reviewerResult.tokensUsed}, Duration: ${reviewerResult.durationMs}ms):`);
    console.log(`    "${reviewerResult.output}"`);

    console.log('\n[4/4] Querying SQLite persistent delegation records...');
    const delegations = runtime.persistence.query(
      'SELECT id, parent_task_id, agent_type, state, created_at FROM delegations WHERE parent_task_id = ?',
      ['task-feat-users-api']
    );

    delegations.forEach((d) => {
      console.log(`  ✓ Delegation ${d.id}: Agent="${d.agent_type}", State="${d.state}", Parent="${d.parent_task_id}"`);
    });

    console.log('\n✅ Demo A (Multi-Agent Delegation) completed successfully.\n');
  } finally {
    await runtime.shutdown();
  }
}

runDemoA().catch((err) => {
  console.error('Demo A failed:', err);
  process.exit(1);
});
