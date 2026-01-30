import { describe, expect, it, vi } from 'vitest';
import { restoreAccessFromStorage, restoreBackupFromStorage } from '../../utils/accessStorage';

describe('access storage helpers', () => {
  it('returns null when storage throws on access restore', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      removeItem: vi.fn()
    } as unknown as Storage;

    expect(() => restoreAccessFromStorage(storage, 'access-key')).not.toThrow();
    expect(restoreAccessFromStorage(storage, 'access-key')).toBeNull();
  });

  it('returns null when storage throws on backup restore', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      removeItem: vi.fn()
    } as unknown as Storage;

    expect(() => restoreBackupFromStorage(storage, 'backup-key')).not.toThrow();
    expect(restoreBackupFromStorage(storage, 'backup-key')).toBeNull();
  });
});
