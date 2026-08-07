import { createFuckClawRuntime } from '@fuckclaw/cli';
import path from 'node:path';
import fs from 'node:fs';

class DemoMockProvider {
  name = 'demo-mock';
  async generate(req) {
    const historyText = JSON.stringify(req.messages);

    // If it is asking about previous session
    if (historyText.includes('previous session') || historyText.includes('recalled')) {
      const isRecalled = historyText.includes('DeepCosmos');
      if (isRecalled) {
        return {
          content: 'Thought: The recalled context contains the details from the previous session.\nFinal Answer: The codename was DeepCosmos and the filename was secret-project-alpha.txt.',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
        };
      } else {
        return {
          content: 'Thought: I do not have memory of this.\nFinal Answer: I do not know.',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
        };
      }
    }

    // Otherwise it is the action task (create file)
    if (historyText.includes('Observation:')) {
      return {
        content: 'Thought: I have verified the file is written.\nFinal Answer: File secret-project-alpha.txt created successfully.',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
      };
    }

    return {
      content: 'Thought: I need to write the file to the workspace.\nAction: filesystem\nAction Input: {"action":"write","path":"secret-project-alpha.txt","content":"Project Alpha codename: DeepCosmos"}',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
    };
  }
}

async function runMilestone4Demo() {
  console.log('=== FuckClaw Milestone 4 Persistent Recall Demonstration ===');

  const demoDir = path.resolve('./.fuckclaw-m4-demo');
  if (fs.existsSync(demoDir)) {
    fs.rmSync(demoDir, { recursive: true, force: true });
  }
  fs.mkdirSync(demoDir, { recursive: true });

  const customConfig = {
    workspace: { root: demoDir },
    logging: { level: 'info' }
  };

  console.log('\n--- Session 1: Performing an Action and Recording to Persistent Memory ---');
  const runtime1 = await createFuckClawRuntime(customConfig, new DemoMockProvider());

  const task1 = await runtime1.kernel.submitTask({
    description: 'Create a file named secret-project-alpha.txt in the workspace with content "Project Alpha codename: DeepCosmos", and confirm completion.'
  });

  console.log(`Session 1 Task State: ${task1.state}`);
  console.log(`Session 1 Error: ${JSON.stringify(task1.error)}`);
  console.log(`Session 1 Output: ${task1.output}`);
  console.log(`Session 1 Tool Calls: ${task1.results.filter(r => r.action === 'filesystem').length}`);

  // Clean shutdown of Session 1
  console.log('Shutting down Session 1 runtime...');
  await runtime1.shutdown();

  console.log('\n--- Session 2: Spawning Fresh Runtime & Querying Memory Across Sessions ---');
  // Re-spawn runtime pointing to the same workspace & database
  const runtime2 = await createFuckClawRuntime(customConfig, new DemoMockProvider());

  const task2 = await runtime2.kernel.submitTask({
    description: 'What was the secret project codename and filename created in the previous session?'
  });

  console.log(`Session 2 Task State: ${task2.state}`);
  console.log(`Session 2 Output: ${task2.output}`);

  console.log('Shutting down Session 2 runtime...');
  await runtime2.shutdown();

  // Validate the recall
  const outputLower = (task2.output ?? '').toLowerCase();
  const containsCodename = outputLower.includes('deepcosmos') || outputLower.includes('alpha');
  const containsFile = outputLower.includes('secret-project-alpha.txt') || outputLower.includes('alpha');

  if (!containsCodename && !containsFile) {
    throw new Error(`Demo failed: Session 2 did not recall the prior action. Output: ${task2.output}`);
  }

  console.log('\n=== Milestone 4 Persistent Recall Slice Verified Successfully ===');
}

runMilestone4Demo().catch((error) => {
  console.error('Fatal demo failure:', error);
  process.exit(1);
});
