import { IObservability } from '@fuckclaw/observability';
import { EpisodicStore } from '../episodic/episodic-store.js';

export class DreamingEngine {
  constructor(
    _episodicStore: EpisodicStore,
    private logger?: IObservability
  ) {}

  async dream(): Promise<void> {
    this.logger?.log({
      level: 'debug',
      message: 'Dreaming engine cycle executed',
    });
  }
}
