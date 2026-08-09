import { StructuredToolError, ErrorCategory } from '../types.js';

export class ErrorClassifier {
  static classify(err: any): StructuredToolError {
    const message = err?.message || String(err);
    let category: ErrorCategory = 'internal';
    let code = err?.code || 'TOOL_ERROR';
    let retryable = false;

    if (err?.name === 'ZodError' || /validation|invalid/i.test(message)) {
      category = 'internal';
      code = 'INVALID_PARAMS';
      retryable = false;
    } else if (err?.killed || /timeout/i.test(message)) {
      category = 'timeout';
      code = 'TIMEOUT';
      retryable = true;
    } else if (err?.code === 'ENOENT' || /not found/i.test(message)) {
      category = 'not_found';
      code = 'NOT_FOUND';
    } else if (err?.code === 'EACCES' || err?.code === 'EPERM' || /permission/i.test(message)) {
      category = 'permission';
      code = 'PERMISSION_DENIED';
    } else if (/econnrefused|etimedout|enotfound/i.test(message)) {
      category = 'network';
      code = 'NETWORK_ERROR';
      retryable = true;
    }

    return {
      code,
      message,
      category,
      retryable,
      details: err?.details ?? (err?.stderr ? { stderr: err.stderr } : undefined),
    };
  }
}
