import { FuckClawRuntimeInstance } from '../index.js';
import { StreamRenderer } from '../tui/stream-renderer.js';
import { ANSI } from '../tui/banner.js';

export async function executeRunCommand(runtime: FuckClawRuntimeInstance, goal: string): Promise<void> {
  if (!goal || !goal.trim()) {
    console.error('Error: Goal cannot be empty');
    return;
  }

  console.log(`\n${ANSI.bold}${ANSI.cyan}🎯 Autonomous Goal Execution:${ANSI.reset} "${goal}"\n`);

  try {
    // 1. Decompose goal with Planner
    console.log(`${ANSI.dim}Planning steps...${ANSI.reset}`);
    const plan = await runtime.planner.plan(goal);
    console.log(`${ANSI.green}✓ Generated plan with ${plan.steps.length} steps (Strategy: ${plan.strategy}):${ANSI.reset}`);
    plan.steps.forEach((step, idx) => {
      console.log(`   ${idx + 1}. [${step.type.kind}] ${step.description}`);
    });
    console.log();

    // 2. Execute plan
    console.log(`${ANSI.cyan}Executing plan...${ANSI.reset}`);
    const planResult = await runtime.planner.executePlan(plan);

    const hasOutput = planResult.output && planResult.output.trim().length > 0;
    const allStepsCompleted = planResult.completedSteps === planResult.totalSteps;

    if (hasOutput && allStepsCompleted) {
      console.log(`\n${ANSI.bold}${ANSI.green}Plan Execution Completed!${ANSI.reset}`);
      StreamRenderer.renderFinalResponse(planResult.output);
      console.log(`Completed Steps: ${planResult.completedSteps} / ${planResult.totalSteps}`);
    } else if (hasOutput && !allStepsCompleted) {
      console.log(`\n${ANSI.bold}${ANSI.yellow}Plan Partially Completed${ANSI.reset}`);
      StreamRenderer.renderFinalResponse(planResult.output);
      console.log(`Completed Steps: ${planResult.completedSteps} / ${planResult.totalSteps}`);
      StreamRenderer.renderWarning(
        `Only ${planResult.completedSteps} of ${planResult.totalSteps} steps completed.`
      );
    } else if (!hasOutput && allStepsCompleted) {
      StreamRenderer.renderWarning(
        `Plan executed all ${planResult.totalSteps} steps but produced no user-visible output. ` +
        `This may indicate a configuration or provider issue.`
      );
    } else {
      StreamRenderer.renderError(
        `Plan execution failed: ${planResult.completedSteps}/${planResult.totalSteps} steps completed with no output.`
      );
    }
  } catch (err: unknown) {
    StreamRenderer.renderError((err as Error).message || String(err));
  }
}
