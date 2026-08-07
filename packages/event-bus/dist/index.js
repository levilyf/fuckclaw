import { ulid } from 'ulidx';
export class EventBus {
    db;
    logger;
    handlers = new Map();
    constructor(db, logger) {
        this.db = db;
        this.logger = logger;
    }
    async emit(type, payload) {
        const id = ulid();
        const event = {
            id,
            timestamp: new Date().toISOString(),
            type,
            payload
        };
        // Persist
        this.db.execute('INSERT INTO events (id, timestamp, type, payload) VALUES (?, ?, ?, ?)', [event.id, event.timestamp, event.type, JSON.stringify(event.payload)]);
        this.logger.log({ level: 'debug', message: 'Event emitted', metadata: { type, id } });
        // Dispatch
        const typeHandlers = this.handlers.get(type) || new Set();
        const allHandlers = this.handlers.get('*') || new Set();
        const promises = Array.from(new Set([...typeHandlers, ...allHandlers])).map(async (handler) => {
            try {
                await handler(event);
            }
            catch (err) {
                this.logger.log({ level: 'error', message: 'Event handler error', metadata: { error: String(err) } });
            }
        });
        await Promise.allSettled(promises);
        return id;
    }
    subscribe(type, handler) {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, new Set());
        }
        this.handlers.get(type).add(handler);
        return () => {
            this.handlers.get(type)?.delete(handler);
        };
    }
}
//# sourceMappingURL=index.js.map