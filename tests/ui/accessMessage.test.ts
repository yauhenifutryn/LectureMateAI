import { describe, expect, it } from 'vitest';
import { messageForAccessError } from '../../utils/accessMessage';

describe('messageForAccessError', () => {
  it('maps storage_unavailable to a clear hint', () => {
    expect(
      messageForAccessError('storage_unavailable', 'Service storage is temporarily unavailable.')
    ).toContain('storage');
  });
  it('passes through normal messages', () => {
    expect(messageForAccessError('unauthorized', 'Invalid admin password.')).toBe('Invalid admin password.');
  });
});
