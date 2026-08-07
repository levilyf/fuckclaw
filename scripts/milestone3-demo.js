import { createFuckClawRuntime } from '@fuckclaw/cli';

class Milestone3DemoProvider {
  name = 'm3-react-provider';
  callCount = 0;

  async generate(request) {
    this.callCount++;
    if (this.callCount === 1) {
      return {
        content: `Thought: I will write a Milestone 3 verification note to the workspace.
Action: filesystem
Action Input: {"action":"write","path":"workspace/m3-verification.txt","content":"FuckClaw Milestone 3 Ethereal Agent Slice Verified!"}`,
        provider: this.name,
        model: 'm3-demo',
        usage: { promptTokens: 25, completionTokens: 35, totalTokens: 60 }
      };
    } else if (this.callCount === 2) {
      return {
        content: `Thought: I should verify the file contents using the shell tool.
Action: shell
Action Input: {"command":"cat /data/data/com.termux/files/home/.fuckclaw/workspace/m3-verification.txt"}`,
        provider: this.name,
        model: 'm3-demo',
        usage: { promptTokens: 40, completionTokens: 20, totalTokens: 60 }
      };
    } else {
      return {
        content: `Thought: Both filesystem and shell tools executed successfully. Task is complete.
Final Answer: Milestone 3 end-to-end cognitive loop and tool execution verified successfully.`,
        provider: this.name,
        model: 'm3-demo',
        usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 }
      };
    }
  }
}

async function runMilestone3Demo() {
  console.log('=== FuckClaw Milestone 3 Vertical Slice Demo ===');

  const runtime = await createFuckClawRuntime({}, new Milestone3DemoProvider());
  try {
    const task = await runtime.kernel.submitTask({
      description: 'Create and verify m3-verification.txt in the workspace',
      priority: 1
    });

    console.log('\n--- Task Lifecycle & Output ---');
    console.log(`Task ID: ${task.id}`);
    console.log(`Final State: ${task.state}`);
    console.log(`Final Output: ${task.output}`);
    console.log(`Execution Steps (${task.results.length}):`);
    task.results.forEach((s) => {
      console.log(`  [Step ${s.step}] Action: ${s.action} | Thought: "${s.thought}" | Observation: "${s.observation}" | Success: ${s.success}`);
    });
  } finally {
    await runtime.shutdown();
    console.log('=== Milestone 3 Slice Complete & Cleanly Shut Down ===');
  }
}

runMilestone3Demo().catch(err => {
  console.error('Fatal demo failure:', err);
  process.exit(1);
});
