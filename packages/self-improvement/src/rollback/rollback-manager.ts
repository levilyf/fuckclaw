import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { ISkillEngine } from '@fuckclaw/skills';
import { FuckClawError } from '@fuckclaw/core';

export class RollbackManager {
  constructor(
    private persistence: IPersistenceLayer,
    private logger: IObservability,
    private eventBus: IEventBus,
    private skillEngine?: ISkillEngine
  ) {}

  public async rollbackChange(changeId: string): Promise<void> {
    this.logger.log({
      level: 'warn',
      module: 'self-improvement',
      message: `Initiating rollback for self-improvement change: ${changeId}`,
      metadata: { changeId },
    });

    // 1. Check prompt_mutations table
    const promptRows = this.persistence.query<{ id: string; target: string; version: number }>(
      `SELECT id, target, version FROM prompt_mutations WHERE id = ?`,
      [changeId]
    );

    if (promptRows.length > 0) {
      const row = promptRows[0]!;
      this.persistence.execute(
        `UPDATE prompt_mutations SET status = 'rolled_back', updated_at = ? WHERE id = ?`,
        [Date.now(), changeId]
      );

      this.logger.log({
        level: 'info',
        module: 'self-improvement',
        message: `Rolled back prompt mutation ${changeId} (target: "${row.target}", v${row.version})`,
        metadata: { changeId, target: row.target, version: row.version },
      });

      await this.eventBus.emit('self_improvement.rollback', {
        changeId,
        type: 'prompt_mutation',
        target: row.target,
        version: row.version,
      });
      return;
    }

    // 2. Check skills if skill engine is present
    if (this.skillEngine && this.skillEngine.get(changeId) !== null) {
      this.logger.log({
        level: 'info',
        module: 'self-improvement',
        message: `Rolling back skill ${changeId} to default state`,
      });

      await this.eventBus.emit('self_improvement.rollback', {
        changeId,
        type: 'skill',
      });
      return;
    }

    throw new FuckClawError(
      'FC_SELF_IMPROVEMENT_CHANGE_NOT_FOUND',
      `Cannot rollback change ID "${changeId}": record not found in prompt mutations or skills`
    );
  }
}
