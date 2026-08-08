import { createFuckClawRuntime } from '@fuckclaw/cli';
import path from 'node:path';
import fs from 'node:fs';

class DemoMockProvider {
  name = 'demo-mock';
  async generate(req) {
    const lastMessage = req.messages[req.messages.length - 1]?.content || '';
    const firstUserMessage = req.messages.find(m => m.role === 'user')?.content || '';
    const historyText = JSON.stringify(req.messages);

    // If an observation just came in
    if (lastMessage.startsWith('Observation:')) {
      if (historyText.includes('workspace/editor.txt')) {
        return {
          content: 'Thought: The filesystem write observation is confirmed.\nFinal Answer: I wrote your favorite editor to workspace/editor.txt.',
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
        };
      }
    }

    // DEMO A: Session 1 (Memory capture via Kernel & Memory System)
    if (firstUserMessage.includes('remember my name is levi')) {
      return {
        content: 'Thought: The fact has been captured in the system context. No external tool execution is required.\nFinal Answer: I will remember your name is levi.',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
      };
    }

    // DEMO B: Session 2 (Explicit file task)
    if (firstUserMessage.includes('workspace/editor.txt')) {
      return {
        content: 'Thought: This task explicitly requests a file write to the workspace.\nAction: filesystem\nAction Input: {"action":"write","path":"workspace/editor.txt","content":"favorite editor is Zed"}',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
      };
    }

    // DEMO A: Session 3 (Memory recall across sessions)
    if (firstUserMessage.includes('What is my name')) {
      // The kernel context retrieval will inject the fact into the system prompt!
      const isRecalled = historyText.includes('User name is levi') || historyText.includes('levi');
      if (isRecalled) {
        return {
          content: 'Thought: The context states the user name is levi from persistent memory. No tools are needed.\nFinal Answer: Your name is levi.',
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
  console.log('=== FuckClaw Milestone 4 Memory System & Recall Demonstration ===');

  const demoDir = path.resolve('./.fuckclaw-m4-demo');
  if (fs.existsSync(demoDir)) {
    fs.rmSync(demoDir, { recursive: true, force: true });
  }
  fs.mkdirSync(demoDir, { recursive: true });

  const customConfig = {
    workspace: { root: demoDir },
    logging: { level: 'info' }
  };

  console.log('\n--- DEMO A: Session 1 (Memory Capture into Memory System) ---');
  const runtime1 = await createFuckClawRuntime(customConfig, new DemoMockProvider());

  const task1 = await runtime1.kernel.submitTask({
    description: 'Please remember my name is levi.'
  });

  const externalToolCalls1 = task1.results.filter(r => r.action !== 'finish');
  console.log(`Task State: ${task1.state}`);
  console.log(`Output: ${task1.output}`);
  console.log(`External Tool Calls: ${externalToolCalls1.length}`);

  if (externalToolCalls1.length > 0) {
    throw new Error('Demo failed: Session 1 should capture memory without calling external tools.');
  }

  // Clean shutdown of Session 1
  await runtime1.shutdown();

  console.log('\n--- DEMO B: Session 2 (Explicit File Task using Filesystem Tool) ---');
  const runtime2 = await createFuckClawRuntime(customConfig, new DemoMockProvider());

  const task2 = await runtime2.kernel.submitTask({
    description: 'Please write my favorite editor Zed to workspace/editor.txt.'
  });

  console.log(`Task State: ${task2.state}`);
  console.log(`Output: ${task2.output}`);
  console.log(`Filesystem Tool Calls: ${task2.results.filter(r => r.action === 'filesystem').length}`);

  if (task2.results.filter(r => r.action === 'filesystem').length !== 1) {
    throw new Error('Demo failed: Session 2 should have invoked the filesystem tool.');
  }

  const writtenFilePath = path.join(demoDir, 'workspace/editor.txt');
  if (!fs.existsSync(writtenFilePath)) {
    throw new Error(`Demo failed: Expected file ${writtenFilePath} was not created.`);
  }
  console.log(`File created at ${writtenFilePath} with content: "${fs.readFileSync(writtenFilePath, 'utf8')}"`);
  
  await runtime2.shutdown();

  console.log('\n--- DEMO A: Session 3 (Query Memory Across Sessions via Memory System) ---');
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
    throw new Error(`Demo failed: Session 3 did not recall the user name from memory. Output: ${task3.output}`);
  }
  
  if (task3.results.some(r => r.action === 'filesystem')) {
    throw new Error(`Demo failed: Session 3 incorrectly used the filesystem for recall.`);
  }

  console.log('\n=== Milestone 4 Memory Subsystem Demonstration Verified Successfully ===');
}

runMilestone4Demo().catch((error) => {
  console.error('Fatal demo failure:', error);
  process.exit(1);
});
