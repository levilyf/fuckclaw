import { z } from 'zod';
export const GlobalConfigSchema = z.object({
    workspace: z.object({
        root: z.string().default('~/.fuckclaw'),
    }).default({}),
    logging: z.object({
        level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    }).default({}),
});
export class ConfigManager {
    config;
    constructor(initialConfig = {}) {
        this.config = GlobalConfigSchema.parse(initialConfig);
    }
    get() {
        return this.config;
    }
}
//# sourceMappingURL=index.js.map