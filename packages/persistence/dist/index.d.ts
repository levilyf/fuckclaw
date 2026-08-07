import { IObservability } from '@fuckclaw/observability';
export interface IPersistenceLayer {
    execute(sql: string, params?: unknown[]): void;
    query<T>(sql: string, params?: unknown[]): T[];
    close(): void;
}
export declare class PersistenceLayer implements IPersistenceLayer {
    private logger?;
    private db;
    constructor(dbPath?: string, logger?: IObservability | undefined);
    private init;
    private migrate;
    execute(sql: string, params?: unknown[]): void;
    query<T>(sql: string, params?: unknown[]): T[];
    close(): void;
}
//# sourceMappingURL=index.d.ts.map