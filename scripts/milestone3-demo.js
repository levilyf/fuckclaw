import { runTaskCLI } from '@fuckclaw/cli';

async function runMilestone3Demo() {
  console.log('=== FuckClaw Milestone 3 Real Provider Vertical Slice ===');
  const task = await runTaskCLI(
    'Create a file named m3-real-verification.txt in the workspace with content "FuckClaw real LLM tool loop verified", then read it to verify the content before returning the final answer.'
  );

  console.log('\n--- Task Lifecycle & Output ---');
  console.log(`Task ID: ${task.id}`);
  console.log(`Final State: ${task.state}`);
  console.log(`Final Output: ${task.output ?? '(no output)'}`);
  console.log(`Execution Steps (${task.results.length}):`);
  task.results.forEach((step) => {
    console.log(`  [Step ${step.step}] Action: ${step.action} | Success: ${step.success}`);
    console.log(`    Observation: ${String(step.observation ?? '')}`);
  });

  if (!task.results.some((step) => step.action === 'filesystem' || step.action === 'shell')) {
    throw new Error('Demo failed: the real model did not invoke a tool');
  }
  if (task.state !== 'completed') {
    throw new Error(`Demo failed: task ended in state ${task.state}`);
  }

  console.log('=== Milestone 3 Real Provider Slice Complete ===');
}

runMilestone3Demo().catch((error) => {
  console.error('Fatal demo failure:', error);
  process.exit(1);
});
