import { IConfigManager } from '@fuckclaw/config';
export interface LogEntry {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
}
export interface IObservability {
    log(entry: Omit<LogEntry, 'timestamp'>): void;
}
export declare class Logger implements IObservability {
    private configManager;
    constructor(configManager: IConfigManager);
    log(entry: Omit<LogEntry, 'timestamp'>): void;
}
//# sourceMappingURL=index.d.ts.map