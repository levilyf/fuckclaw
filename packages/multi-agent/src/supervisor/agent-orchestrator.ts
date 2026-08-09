import { ulid } from 'ulidx';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { LLMRouter } from '@fuckclaw/llm-router';
import { IMemorySystem } from '@fuckclaw/memory';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import {
  IAgentOrchestrator,
  AgentSpec,
  AgentDelegation,
  AgentResult,
  AgentInstance,
} from '../types.js';
import { AGENT_SPECS } from '../specs/default-specs.js';
import { AgentPool } from '../pool/agent-pool.js';
import { DelegationExecutor } from './delegation-executor.js';

export class AgentOrchestrator implements IAgentOrchestrator {
  private pool: AgentPool;
  private executor: DelegationExecutor;
  private delegations: Map<string, AgentDelegation> = new Map();

  constructor(
    private logger: IObservability,
    private eventBus: IEventBus,
    toolRuntime: IToolRuntime,
    llmRouter: LLMRouter,
    workspace?: IWorkspaceManager,
    memory?: IMemorySystem,
    private persistence?: IPersistenceLayer,
    customSpecs: Record<string, AgentSpec> = {}
  ) {
    const allSpecs = { ...AGENT_SPECS, ...customSpecs };
    this.pool = new AgentPool(allSpecs, logger);
    this.executor = new DelegationExecutor(
      logger,
      eventBus,
      toolRuntime,
      llmRouter,
      workspace,
      memory,
      persistence
    );
  }

  public registerAgentType(spec: AgentSpec): void {
    this.pool.registerSpec(spec);
    this.logger.log({
      level: 'info',
      module: 'multi-agent',
      message: `Registered custom agent role: "${spec.type}" (${spec.role})`,
    });
  }

  public getAgentSpec(type: string): AgentSpec | undefined {
    return this.pool.getSpec(type);
  }

  public async delegate(
    input: Omit<AgentDelegation, 'id' | 'state'>
  ): Promise<AgentResult> {
    const delegationId = ulid();
    const delegation: AgentDelegation = {
      ...input,
      id: delegationId,
      state: 'pending',
      timeoutMs: input.timeoutMs || 60000,
      context: input.context || {},
      budget: input.budget || {},
    };

    this.delegations.set(delegationId, delegation);

    let instance: AgentInstance | undefined;
    try {
      instance = await this.pool.acquireSlot(delegation.agentType, delegation);
      delegation.state = 'executing';

      const result = await this.executor.executeDelegation(instance, delegation);
      return result;
    } catch (err: any) {
      delegation.state = 'failed';
      const errorMsg = err.message || String(err);

      this.logger.log({
        level: 'error',
        module: 'multi-agent',
        message: `Delegation ${delegationId} to "${delegation.agentType}" failed: ${errorMsg}`,
        metadata: { delegationId, agentType: delegation.agentType, error: errorMsg },
      });

      await this.eventBus.emit(`agent.${delegation.agentType}.failed`, {
        delegationId,
        parentTaskId: delegation.parentTaskId,
        agentType: delegation.agentType,
        error: errorMsg,
      });

      const failedResult: AgentResult = {
        success: false,
        output: `Agent delegation failed: ${errorMsg}`,
        tokensUsed: 0,
        costUsd: 0,
        durationMs: 0,
      };
      delegation.result = failedResult;
      return failedResult;
    } finally {
      if (instance) {
        this.pool.releaseSlot(instance);
      }
    }
  }

  public async delegateParallel(
    delegations: Omit<AgentDelegation, 'id' | 'state'>[]
  ): Promise<AgentResult[]> {
    this.logger.log({
      level: 'info',
      module: 'multi-agent',
      message: `Dispatching parallel delegations to ${delegations.length} agents: [${delegations.map((d) => d.agentType).join(', ')}]`,
    });

    return Promise.all(delegations.map((d) => this.delegate(d)));
  }

  public status(delegationId: string): AgentDelegation | null {
    const memoryFound = this.delegations.get(delegationId);
    if (memoryFound) {
      return memoryFound;
    }

    if (this.persistence) {
      const rows = this.persistence.query<{
        id: string;
        parent_task_id: string;
        agent_type: string;
        task: string;
        context_json: string;
        expected_output_json: string | null;
        budget_json: string;
        timeout_ms: number;
        state: string;
        result_json: string | null;
      }>('SELECT * FROM delegations WHERE id = ?', [delegationId]);

      const row = rows[0];
      if (row) {
        return {
          id: row.id,
          parentTaskId: row.parent_task_id,
          agentType: row.agent_type,
          task: row.task,
          context: JSON.parse(row.context_json || '{}'),
          expectedOutput: row.expected_output_json ? JSON.parse(row.expected_output_json) : undefined,
          budget: JSON.parse(row.budget_json || '{}'),
          timeoutMs: row.timeout_ms,
          state: row.state as any,
          result: row.result_json ? JSON.parse(row.result_json) : undefined,
        };
      }
    }

    return null;
  }

  public async cancel(delegationId: string): Promise<void> {
    const delegation = this.delegations.get(delegationId);
    if (delegation && delegation.state === 'executing') {
      delegation.state = 'cancelled';
      const activeInstance = this.pool
        .getActiveInstances(delegation.agentType)
        .find((i) => i.delegation.id === delegationId);

      if (activeInstance) {
        this.pool.releaseSlot(activeInstance);
      }

      await this.eventBus.emit(`agent.${delegation.agentType}.cancelled`, {
        delegationId,
        parentTaskId: delegation.parentTaskId,
        agentType: delegation.agentType,
      });

      this.logger.log({
        level: 'warn',
        module: 'multi-agent',
        message: `Cancelled delegation ${delegationId} for agent "${delegation.agentType}"`,
      });
    }
  }

  public listActive(): AgentInstance[] {
    return this.pool.getActiveInstances();
  }
}
