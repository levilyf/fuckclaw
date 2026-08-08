import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { KernelState } from '../types.js';

export class KernelStateMachine {
  private state: KernelState = KernelState.BOOTING;

  constructor(
    private logger: IObservability,
    private eventBus: IEventBus
  ) {}

  getState(): KernelState {
    return this.state;
  }

  transition(newState: KernelState): void {
    const oldState = this.state;
    this.state = newState;
    this.logger.log({
      level: 'info',
      module: 'kernel',
      message: `Agent Kernel state transitioned: ${oldState} -> ${newState}`,
      metadata: { from: oldState, to: newState },
    });
    this.eventBus.emit('kernel.state.changed', { from: oldState, to: newState });
  }
}
