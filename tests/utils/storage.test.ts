import { describe, expect, it, vi } from 'vitest';
import { safeGetItem, safeRemoveItem, safeSetItem } from '../../utils/storage';

describe('safe storage helpers', () => {
  it('does not throw when setItem fails', () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new Error('blocked');
      })
    } as unknown as Storage;

    expect(() => safeSetItem(storage, 'key', 'value')).not.toThrow();
    expect(storage.setItem).toHaveBeenCalledWith('key', 'value');
  });

  it('does not throw when removeItem fails', () => {
    const storage = {
      removeItem: vi.fn(() => {
        throw new Error('blocked');
      })
    } as unknown as Storage;

    expect(() => safeRemoveItem(storage, 'key')).not.toThrow();
    expect(storage.removeItem).toHaveBeenCalledWith('key');
  });

  it('does not throw when getItem fails', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      })
    } as unknown as Storage;

    expect(() => safeGetItem(storage, 'key')).not.toThrow();
    expect(storage.getItem).toHaveBeenCalledWith('key');
  });
});
