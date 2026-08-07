import { SystemEvent } from '@fuckclaw/core';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
export type EventHandler = (event: SystemEvent) => Promise<void> | void;
export interface IEventBus {
    emit(type: string, payload: Record<string, unknown>): Promise<string>;
    subscribe(type: string, handler: EventHandler): () => void;
}
export declare class EventBus implements IEventBus {
    private db;
    private logger;
    private handlers;
    constructor(db: IPersistenceLayer, logger: IObservability);
    emit(type: string, payload: Record<string, unknown>): Promise<string>;
    subscribe(type: string, handler: EventHandler): () => void;
}
//# sourceMappingURL=index.d.ts.map