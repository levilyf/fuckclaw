import { ulid } from 'ulidx';
import { IObservability } from '@fuckclaw/observability';
import { FuckClawError } from '@fuckclaw/core';
import { AgentSpec, AgentDelegation, AgentInstance } from '../types.js';

interface QueuedDelegation {
  agentType: string;
  delegation: AgentDelegation;
  resolve: (instance: AgentInstance) => void;
  reject: (err: Error) => void;
}

export class AgentPool {
  private instances: Map<string, AgentInstance[]> = new Map();
  private specs: Map<string, AgentSpec> = new Map();
  private queue: QueuedDelegation[] = [];

  constructor(
    initialSpecs: Record<string, AgentSpec>,
    private logger?: IObservability
  ) {
    for (const [type, spec] of Object.entries(initialSpecs)) {
      this.specs.set(type, spec);
    }
  }

  public registerSpec(spec: AgentSpec): void {
    this.specs.set(spec.type, spec);
  }

  public getSpec(type: string): AgentSpec | undefined {
    return this.specs.get(type);
  }

  public async acquireSlot(agentType: string, delegation: AgentDelegation): Promise<AgentInstance> {
    const spec = this.specs.get(agentType);
    if (!spec) {
      throw new FuckClawError(
        'FC_MULTIAGENT_UNKNOWN_ROLE',
        `No registered agent specification for role: "${agentType}"`
      );
    }

    const active = this.getActiveInstances(agentType);

    if (active.length >= spec.maxInstances) {
      this.logger?.log({
        level: 'warn',
        module: 'multi-agent',
        message: `AgentPool concurrency limit reached for role "${agentType}" (${active.length}/${spec.maxInstances}). Queueing delegation ${delegation.id}...`,
        metadata: { agentType, delegationId: delegation.id },
      });

      return new Promise<AgentInstance>((resolve, reject) => {
        const timeoutTimer = setTimeout(() => {
          const idx = this.queue.findIndex((q) => q.delegation.id === delegation.id);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
          }
          reject(
            new FuckClawError(
              'FC_MULTIAGENT_POOL_TIMEOUT',
              `Timeout waiting for available agent slot for role "${agentType}" on delegation ${delegation.id}`
            )
          );
        }, delegation.timeoutMs || 30000);

        this.queue.push({
          agentType,
          delegation,
          resolve: (inst) => {
            clearTimeout(timeoutTimer);
            resolve(inst);
          },
          reject: (err) => {
            clearTimeout(timeoutTimer);
            reject(err);
          },
        });
      });
    }

    const instance: AgentInstance = {
      id: ulid(),
      spec,
      delegation,
      state: 'executing',
      startedAt: Date.now(),
    };

    const currentList = this.instances.get(agentType) ?? [];
    currentList.push(instance);
    this.instances.set(agentType, currentList);

    return instance;
  }

  public releaseSlot(instance: AgentInstance): void {
    instance.completedAt = Date.now();
    instance.state = instance.delegation.state;

    // Check if there are queued requests for this agent type
    const nextIdx = this.queue.findIndex((q) => q.agentType === instance.spec.type);
    if (nextIdx !== -1) {
      const [nextItem] = this.queue.splice(nextIdx, 1);
      if (nextItem) {
        const nextInstance: AgentInstance = {
          id: ulid(),
          spec: instance.spec,
          delegation: nextItem.delegation,
          state: 'executing',
          startedAt: Date.now(),
        };

        const currentList = this.instances.get(instance.spec.type) ?? [];
        currentList.push(nextInstance);
        this.instances.set(instance.spec.type, currentList);

        nextItem.resolve(nextInstance);
      }
    }
  }

  public getActiveInstances(agentType?: string): AgentInstance[] {
    if (agentType) {
      const list = this.instances.get(agentType) ?? [];
      return list.filter((i) => i.state === 'executing');
    }

    const allActive: AgentInstance[] = [];
    for (const list of this.instances.values()) {
      for (const inst of list) {
        if (inst.state === 'executing') {
          allActive.push(inst);
        }
      }
    }
    return allActive;
  }

  public getAllInstances(): AgentInstance[] {
    const all: AgentInstance[] = [];
    for (const list of this.instances.values()) {
      all.push(...list);
    }
    return all;
  }
}
