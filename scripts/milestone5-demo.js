import { createFuckClawRuntime } from '@fuckclaw/cli';
import path from 'node:path';
import fs from 'node:fs';

class Milestone5MockProvider {
  name = 'm5-mock';
  step3FailedOnce = false;

  async generate(req) {
    const historyText = JSON.stringify(req.messages);

    // 1. LLM Planning Prompt
    if (historyText.includes('FuckClaw Deliberate Planner')) {
      return {
        content: JSON.stringify({
          rationale: 'Decompose database refactoring into 4 dependent subtasks',
          steps: [
            { index: 1, description: 'Analyze database module architecture and query patterns', dependsOn: [] },
            { index: 2, description: 'Implement refactored query builder', dependsOn: [1] },
            { index: 3, description: 'Verify and run test suite for refactored query builder', dependsOn: [2] },
            { index: 4, description: 'Finalize module documentation and export', dependsOn: [3] },
          ],
        }),
        usage: { promptTokens: 30, completionTokens: 40, totalTokens: 70 },
      };
    }

    // 2. LLM Replanning Prompt
    if (historyText.includes('FuckClaw Dynamic Replanner')) {
      return {
        content: JSON.stringify({
          recoverySteps: [
            { description: 'Diagnose and fix broken database transactions in query-builder.ts' },
          ],
        }),
        usage: { promptTokens: 30, completionTokens: 30, totalTokens: 60 },
      };
    }

    // 3. Step 3 failure simulation on first attempt
    if (historyText.includes('Verify and run test suite') && !historyText.includes('fix broken database transactions')) {
      if (!this.step3FailedOnce) {
        this.step3FailedOnce = true;
        throw new Error('Vitest test suite failed: 2 broken database transactions in query-builder.ts');
      }
    }

    // 4. Observation response
    if (historyText.includes('Observation:')) {
      return {
        content: 'Thought: The action completed successfully.\nFinal Answer: Subtask execution verified and complete.',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      };
    }

    // 5. Normal subtask execution
    return {
      content: 'Thought: Subtask instructions received.\nFinal Answer: Subtask accomplished successfully.',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    };
  }
}

async function runMilestone5Demo() {
  console.log('=== FuckClaw Milestone 5: Deliberate Action Demonstration ===');

  const demoDir = path.resolve('./.fuckclaw-m5-demo');
  if (fs.existsSync(demoDir)) {
    fs.rmSync(demoDir, { recursive: true, force: true });
  }
  fs.mkdirSync(demoDir, { recursive: true });

  const customConfig = {
    workspace: { root: demoDir },
    logging: { level: 'info' },
  };

  const mockProvider = new Milestone5MockProvider();
  const runtime = await createFuckClawRuntime(customConfig, mockProvider);

  console.log('\n============================================================');
  console.log('DEMO A: Planner-Driven Hierarchical Goal DAG & Replanning');
  console.log('============================================================');

  const goal = 'Refactor database query module and verify test suite';
  console.log(`\n1. Submitting complex goal to Planner: "${goal}"`);

  const initialPlan = await runtime.planner.plan(goal);

  console.log(`\nGenerated Plan ID: ${initialPlan.id} (version ${initialPlan.version})`);
  console.log(`Total Steps in Initial DAG: ${initialPlan.steps.length}`);
  console.log(`Total Dependencies: ${initialPlan.dependencies.length}`);
  console.log('Initial DAG Structure:');
  for (const step of initialPlan.steps) {
    const prereqs = initialPlan.dependencies
      .filter((d) => d.to === step.id)
      .map((d) => initialPlan.steps.find((s) => s.id === d.from)?.index);
    console.log(`  [Step ${step.index}] ${step.description} (Depends on: [${prereqs.join(', ')}])`);
  }

  if (initialPlan.steps.length !== 4) {
    throw new Error(`Expected 4-step decomposition, got ${initialPlan.steps.length}`);
  }

  console.log('\n2. Executing Plan systematically through Kernel...');
  const planResult = await runtime.planner.executePlan(initialPlan);

  console.log(`\nPlan Execution Result:`);
  console.log(`- Success: ${planResult.success}`);
  console.log(`- Final Plan Version: ${planResult.version} (Replanned from v1!)`);
  console.log(`- Completed Steps: ${planResult.completedSteps}/${planResult.totalSteps}`);
  console.log(`- Summary Output: ${planResult.output}`);
  console.log(`\nPost-Execution Reflection:`);
  console.log(`- Outcome: ${planResult.reflection.outcome}`);
  console.log(`- Recovered Failures: ${planResult.reflection.failures.length}`);
  for (const f of planResult.reflection.failures) {
    console.log(`  * Failure in step ${f.stepId}: "${f.reason}" -> ${f.resolution}`);
  }
  console.log(`- Lessons Learned: ${planResult.reflection.lessonsLearned.join('; ')}`);

  if (!planResult.success || planResult.version < 2) {
    throw new Error('Demo A failed: Plan should have recovered from step failure via dynamic replanning.');
  }

  console.log('\n============================================================');
  console.log('DEMO B: Scheduler-Triggered Proactive Automation');
  console.log('============================================================');

  // Register a file-watcher trigger
  const watchFile = path.join(demoDir, 'workspace/auto-trigger.txt');
  fs.mkdirSync(path.dirname(watchFile), { recursive: true });
  fs.writeFileSync(watchFile, 'Initial state');

  runtime.scheduler.registerTrigger({
    id: 'fs-watch-trigger',
    name: 'Auto Process Watch Trigger',
    enabled: true,
    source: {
      type: 'file_watch',
      paths: ['workspace/auto-trigger.txt'],
      events: ['modify'],
      debounceMs: 50,
    },
    taskTemplate: {
      description: 'Process file update in workspace/auto-trigger.txt',
      priority: 30,
    },
    stats: { totalFired: 0, lastFired: 0, lastResult: null },
  });

  // Register a webhook trigger
  runtime.scheduler.registerTrigger({
    id: 'webhook-ci-trigger',
    name: 'CI Build Notification Webhook',
    enabled: true,
    source: {
      type: 'webhook',
      path: '/api/webhooks/ci',
      method: 'POST',
      secret: 'm5-secret-key',
    },
    taskTemplate: {
      description: 'Run post-CI integration review',
      priority: 20,
    },
    stats: { totalFired: 0, lastFired: 0, lastResult: null },
  });

  console.log('\n1. Modifying watched workspace file to trigger FS watcher...');
  fs.appendFileSync(watchFile, '\nNew content appended by external process');

  // Wait for debounced watcher
  await new Promise((resolve) => setTimeout(resolve, 200));

  const fsTriggerStats = runtime.scheduler.getTrigger('fs-watch-trigger').stats;
  console.log(`FS Watcher Trigger Fired: ${fsTriggerStats.totalFired} time(s), Result: ${fsTriggerStats.lastResult}`);

  if (fsTriggerStats.totalFired === 0) {
    throw new Error('Demo B failed: FS watcher trigger did not fire on file modification.');
  }

  console.log('\n2. Invoking webhook trigger via authenticated HTTP request payload...');
  const webhookRes = await runtime.scheduler.handleWebhook({
    path: '/api/webhooks/ci',
    method: 'POST',
    headers: { authorization: 'Bearer m5-secret-key' },
    body: { buildId: 1042, status: 'passed' },
  });

  console.log(`Webhook Response Status: ${webhookRes.statusCode}, Message: "${webhookRes.message}", Task ID: ${webhookRes.taskId}`);

  const webhookStats = runtime.scheduler.getTrigger('webhook-ci-trigger').stats;
  console.log(`Webhook Trigger Fired: ${webhookStats.totalFired} time(s), Result: ${webhookStats.lastResult}`);

  if (webhookRes.statusCode !== 200 || webhookStats.totalFired === 0) {
    throw new Error('Demo B failed: Webhook trigger was not processed successfully.');
  }

  console.log('\nShutting down runtime...');
  await runtime.shutdown();

  console.log('\n=== Milestone 5: Deliberate Action Verified Successfully ===');
}

runMilestone5Demo().catch((err) => {
  console.error('Fatal demo failure:', err);
  process.exit(1);
});
