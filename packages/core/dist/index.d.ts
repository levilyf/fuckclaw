export declare class FuckClawError extends Error {
    readonly code: string;
    readonly details?: Record<string, unknown> | undefined;
    constructor(code: string, message: string, details?: Record<string, unknown> | undefined);
}
export interface SystemEvent {
    id: string;
    timestamp: string;
    type: string;
    payload: Record<string, unknown>;
}
//# sourceMappingURL=index.d.ts.map