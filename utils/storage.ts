export function safeSetItem(storage: Storage | null | undefined, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch (error) {
    console.error('Failed to persist to storage:', error);
  }
}

export function safeGetItem(storage: Storage | null | undefined, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch (error) {
    console.error('Failed to read from storage:', error);
    return null;
  }
}

export function safeRemoveItem(storage: Storage | null | undefined, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (error) {
    console.error('Failed to remove from storage:', error);
  }
}
