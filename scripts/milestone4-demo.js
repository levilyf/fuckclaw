import { createFuckClawRuntime } from '@fuckclaw/cli';
import path from 'node:path';
import fs from 'node:fs';

class DemoMockProvider {
  name = 'demo-mock';
  async generate(req) {
    const historyText = JSON.stringify(req.messages);

    // If an observation just came in
    if (historyText.includes('Observation:')) {
      if (historyText.includes('remember my name is levi')) {
        return {
          content: 'Thought: I have stored the fact in memory.\nFinal Answer: I will remember your name is levi.',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
        };
      }
      if (historyText.includes('workspace/editor.txt')) {
        return {
          content: 'Thought: I have verified the file is written.\nFinal Answer: I wrote your favorite editor to workspace/editor.txt.',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
        };
      }
    }

    const firstUserMessage = req.messages.find(m => m.role === 'user')?.content || '';

    // DEMO A: Memory storage
    if (firstUserMessage.includes('remember my name is levi')) {
      return {
        content: 'Thought: I need to use the memory tool to store this personal fact.\nAction: memory\nAction Input: {"action":"assert_fact","statement":"User name is levi"}',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
      };
    }

    // DEMO B: Explicit file task
    if (firstUserMessage.includes('workspace/editor.txt')) {
      return {
        content: 'Thought: I need to write the file to the workspace.\nAction: filesystem\nAction Input: {"action":"write","path":"workspace/editor.txt","content":"favorite editor is Zed"}',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
      };
    }

    // DEMO A: Memory recall
    if (firstUserMessage.includes('What is my name')) {
      // The kernel context retrieval will inject the fact into the system prompt!
      const isRecalled = historyText.includes('User name is levi');
      if (isRecalled) {
        return {
          content: 'Thought: The context states the user name is levi. I do not need a tool.\nFinal Answer: Your name is levi.',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
        };
      } else {
        return {
          content: 'Thought: I have no memory of this.\nFinal Answer: I do not know.',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
        };
      }
    }

    return {
      content: 'Final Answer: Default response',
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

  console.log('\n--- DEMO A: Session 1 (Store Memory) ---');
  const runtime1 = await createFuckClawRuntime(customConfig, new DemoMockProvider());

  const task1 = await runtime1.kernel.submitTask({
    description: 'Please remember my name is levi.'
  });

  console.log(`Task State: ${task1.state}`);
  console.log(`Output: ${task1.output}`);
  console.log(`Memory Tool Calls: ${task1.results.filter(r => r.action === 'memory').length}`);

  // Clean shutdown of Session 1
  await runtime1.shutdown();

  console.log('\n--- DEMO B: Session 2 (Explicit File Task) ---');
  const runtime2 = await createFuckClawRuntime(customConfig, new DemoMockProvider());

  const task2 = await runtime2.kernel.submitTask({
    description: 'Please write my favorite editor Zed to workspace/editor.txt.'
  });

  console.log(`Task State: ${task2.state}`);
  console.log(`Output: ${task2.output}`);
  console.log(`Filesystem Tool Calls: ${task2.results.filter(r => r.action === 'filesystem').length}`);
  
  await runtime2.shutdown();

  console.log('\n--- DEMO A: Session 3 (Query Memory Across Sessions) ---');
  const runtime3 = await createFuckClawRuntime(customConfig, new DemoMockProvider());

  const task3 = await runtime3.kernel.submitTask({
    description: 'What is my name? Please answer without using the filesystem.'
  });

  console.log(`Task State: ${task3.state}`);
  console.log(`Output: ${task3.output}`);
  console.log(`Filesystem Tool Calls: ${task3.results.filter(r => r.action === 'filesystem').length}`);

  await runtime3.shutdown();

  // Validate the recall
  const outputLower = (task3.output ?? '').toLowerCase();
  const containsName = outputLower.includes('levi');

  if (!containsName) {
    throw new Error(`Demo failed: Session 3 did not recall the prior action from memory. Output: ${task3.output}`);
  }
  
  if (task3.results.some(r => r.action === 'filesystem')) {
    throw new Error(`Demo failed: Session 3 incorrectly used the filesystem for recall.`);
  }

  console.log('\n=== Milestone 4 Persistent Recall Verified Successfully ===');
}

runMilestone4Demo().catch((error) => {
  console.error('Fatal demo failure:', error);
  process.exit(1);
});
