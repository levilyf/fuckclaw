import { z } from 'zod';
export declare const GlobalConfigSchema: z.ZodObject<{
    workspace: z.ZodDefault<z.ZodObject<{
        root: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        root: string;
    }, {
        root?: string | undefined;
    }>>;
    logging: z.ZodDefault<z.ZodObject<{
        level: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
    }, "strip", z.ZodTypeAny, {
        level: "debug" | "info" | "warn" | "error";
    }, {
        level?: "debug" | "info" | "warn" | "error" | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    workspace: {
        root: string;
    };
    logging: {
        level: "debug" | "info" | "warn" | "error";
    };
}, {
    workspace?: {
        root?: string | undefined;
    } | undefined;
    logging?: {
        level?: "debug" | "info" | "warn" | "error" | undefined;
    } | undefined;
}>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export interface IConfigManager {
    get(): GlobalConfig;
}
export declare class ConfigManager implements IConfigManager {
    private config;
    constructor(initialConfig?: Partial<GlobalConfig>);
    get(): GlobalConfig;
}
//# sourceMappingURL=index.d.ts.map