import type { AccessContext } from '../types';
import { safeGetItem, safeRemoveItem } from './storage';

type BackupPayload = {
  result?: unknown;
  timestamp?: number;
};

export function restoreBackupFromStorage(storage: Storage | null | undefined, key: string): BackupPayload | null {
  const savedData = safeGetItem(storage, key);
  if (!savedData) return null;
  try {
    return JSON.parse(savedData) as BackupPayload;
  } catch (error) {
    safeRemoveItem(storage, key);
    console.error('Failed to restore backup:', error);
    return null;
  }
}

export function restoreAccessFromStorage(
  storage: Storage | null | undefined,
  key: string
): AccessContext | null {
  const savedAccess = safeGetItem(storage, key);
  if (!savedAccess) return null;
  try {
    const parsed = JSON.parse(savedAccess) as AccessContext;
    if (parsed?.mode && parsed?.token) {
      return parsed;
    }
  } catch (error) {
    safeRemoveItem(storage, key);
    console.error('Failed to restore access:', error);
  }
  return null;
}
