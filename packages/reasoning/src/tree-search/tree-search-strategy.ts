import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { LLMRouter, ChatMessage } from '@fuckclaw/llm-router';
import { Task, ContextBundle, StepResult } from '@fuckclaw/kernel';
import { IReasoningStrategy, ReasoningStrategyType } from '../types.js';
import { BeamSearch, ReasoningBranch } from './beam-search.js';
import { StateEvaluator } from './state-evaluator.js';
import { ToolCallParser } from '../parsers/tool-call-parser.js';

export class TreeSearchStrategy implements IReasoningStrategy {
  readonly name: ReasoningStrategyType = 'tree_search';
  private beamSearch: BeamSearch;

  constructor(
    private logger: IObservability,
    private eventBus: IEventBus,
    private toolRuntime: IToolRuntime,
    private llmRouter: LLMRouter,
    beamWidth: number = 3,
    maxDepth: number = 4
  ) {
    this.beamSearch = new BeamSearch({ beamWidth, maxDepth, earlyStopScore: 0.90 });
  }

  async execute(task: Task, context: ContextBundle): Promise<{ output: string; steps: StepResult[] }> {
    this.logger.log({
      level: 'info',
      module: 'reasoning.tree_search',
      message: `Executing Tree Search reasoning strategy for task ${task.id}: "${task.description}"`,
      metadata: { taskId: task.id },
    });

    await this.eventBus.emit('reasoning.tree_search.started', { taskId: task.id, goal: task.description });

    // 1. Generate candidate root branches
    let activeBranches: ReasoningBranch[] = [
      {
        id: 'branch-root-1',
        depth: 0,
        steps: [],
        evaluation: StateEvaluator.evaluate(task.description, []),
        contextSummary: context.description,
      },
    ];

    const maxDepth = 4;
    let winner: ReasoningBranch | null = null;

    for (let depth = 1; depth <= maxDepth; depth++) {
      const candidateBranches: ReasoningBranch[] = [];

      for (const branch of activeBranches) {
        // Build prompt for next step in this branch
        const historyMessages: ChatMessage[] = [
          { role: 'system', content: context.systemPrompt },
          { role: 'user', content: task.description },
        ];

        for (const step of branch.steps) {
          if (step.thought) {
            historyMessages.push({ role: 'assistant', content: step.thought });
          }
          if (step.observation) {
            historyMessages.push({ role: 'user', content: `Observation: ${step.observation}` });
          }
        }

        const prompt = `[Depth ${depth}, Branch ${branch.id}] Analyze the goal: "${task.description}". Decide next action or finish response.`;
        historyMessages.push({ role: 'user', content: prompt });

        const llmResponse = await this.llmRouter.generate({
          messages: historyMessages,
          taskId: task.id,
          temperature: 0.2,
        });

        const parsed = ToolCallParser.parse(llmResponse.content);
        const stepNum = branch.steps.length + 1;

        if (parsed.type === 'finish' || (!parsed.toolName && !parsed.thought?.includes('Action:'))) {
          const finishStep: StepResult = {
            step: stepNum,
            thought: parsed.thought ?? llmResponse.content,
            action: 'finish',
            observation: 'Task completed',
            success: true,
          };
          const newSteps = [...branch.steps, finishStep];
          const evalRes = StateEvaluator.evaluate(task.description, newSteps, llmResponse.content);

          candidateBranches.push({
            id: `${branch.id}-d${depth}-finish`,
            depth,
            steps: newSteps,
            evaluation: evalRes,
            contextSummary: branch.contextSummary,
            finalOutput: parsed.finalResponse ?? llmResponse.content,
          });
        } else if (parsed.toolName) {
          let toolSuccess = true;
          let observation = '';

          try {
            const toolResult = await this.toolRuntime.execute(
              parsed.toolName,
              parsed.toolArgs ?? {},
              { taskId: task.id }
            );
            toolSuccess = toolResult.success;
            observation = toolResult.output || (toolResult.error ? toolResult.error.message : '');
          } catch (err: any) {
            toolSuccess = false;
            observation = err.message || String(err);
          }

          const toolStep: StepResult = {
            step: stepNum,
            thought: parsed.thought,
            action: `${parsed.toolName}(${JSON.stringify(parsed.toolArgs ?? {})})`,
            observation,
            success: toolSuccess,
          };

          const newSteps = [...branch.steps, toolStep];
          const evalRes = StateEvaluator.evaluate(task.description, newSteps);

          candidateBranches.push({
            id: `${branch.id}-d${depth}-tool`,
            depth,
            steps: newSteps,
            evaluation: evalRes,
            contextSummary: `${branch.contextSummary} -> ${parsed.toolName}`,
          });
        }
      }

      // Check for winning branch
      winner = this.beamSearch.findWinningBranch(candidateBranches);
      if (winner) {
        break;
      }

      // Prune candidate branches to beam width
      activeBranches = this.beamSearch.pruneBranches(candidateBranches);
      await this.eventBus.emit('reasoning.tree_search.pruned', {
        depth,
        activeBranchesCount: activeBranches.length,
      });

      if (activeBranches.length === 0) {
        break;
      }
    }

    const selectedBranch = winner ?? this.beamSearch.selectBestBranch(activeBranches);
    const lastStepObs = selectedBranch.steps.length > 0 ? String(selectedBranch.steps[selectedBranch.steps.length - 1]!.observation || '') : '';
    const finalOutput = selectedBranch.finalOutput || lastStepObs || 'Tree Search completed';

    await this.eventBus.emit('reasoning.tree_search.completed', {
      taskId: task.id,
      selectedBranchId: selectedBranch.id,
      stepsCount: selectedBranch.steps.length,
      finalScore: selectedBranch.evaluation.score,
    });

    this.logger.log({
      level: 'info',
      module: 'reasoning.tree_search',
      message: `Tree Search finished with winning branch "${selectedBranch.id}" (score: ${selectedBranch.evaluation.score})`,
      metadata: { branchId: selectedBranch.id, steps: selectedBranch.steps.length },
    });

    return {
      output: finalOutput,
      steps: selectedBranch.steps,
    };
  }
}
