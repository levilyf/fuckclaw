import { IObservability } from '@fuckclaw/observability';
import { EpisodicStore } from '../episodic/episodic-store.js';
import { SemanticStore } from '../semantic/semantic-store.js';

export class ConsolidationDaemon {
  constructor(
    _episodicStore: EpisodicStore,
    _semanticStore: SemanticStore,
    private logger?: IObservability
  ) {}

  async consolidate(): Promise<void> {
    this.logger?.log({
      level: 'debug',
      message: 'Memory consolidation cycle executed',
    });
  }
}
