export function messageForAccessError(code: string | undefined, fallback: string): string {
  if (code === 'storage_unavailable') {
    return 'Service storage is temporarily unavailable. If you are the admin, check the data store (Firestore/KV). Otherwise, please contact the admin and try again shortly.';
  }
  return fallback || 'Access denied.';
}
