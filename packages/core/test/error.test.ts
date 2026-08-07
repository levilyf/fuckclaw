import { describe, it, expect } from 'vitest';
import { FuckClawError } from '../src/index.js';

describe('FuckClawError', () => {
  it('should construct with code, message, and details', () => {
    const error = new FuckClawError('FC_TEST', 'A test error', { foo: 'bar' });
    expect(error.name).toBe('FuckClawError');
    expect(error.code).toBe('FC_TEST');
    expect(error.message).toBe('A test error');
    expect(error.details).toEqual({ foo: 'bar' });
  });
});
