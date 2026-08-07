export class FuckClawError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'FuckClawError';
    }
}
//# sourceMappingURL=index.js.map