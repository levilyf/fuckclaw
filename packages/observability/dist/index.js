export class Logger {
    configManager;
    constructor(configManager) {
        this.configManager = configManager;
    }
    log(entry) {
        const config = this.configManager.get();
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        if (levels[entry.level] >= levels[config.logging.level]) {
            const fullEntry = {
                ...entry,
                timestamp: new Date().toISOString(),
            };
            const out = JSON.stringify(fullEntry);
            if (entry.level === 'error') {
                console.error(out);
            }
            else {
                console.log(out);
            }
        }
    }
}
//# sourceMappingURL=index.js.map