import { describe, it, expect } from 'vitest';
import { toPublicError } from '../../api/_lib/errors';

describe('toPublicError', () => {
  it('maps payload too large', () => {
    const err = new Error('Payload Too Large');
    expect(toPublicError(err).code).toBe('payload_too_large');
  });

  it('maps processing timeout', () => {
    const err = new Error('Gemini processing timed out.');
    expect(toPublicError(err).code).toBe('processing_timeout');
  });
});
