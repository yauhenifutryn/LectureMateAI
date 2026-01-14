export type PublicError = {
  code: string;
  message: string;
};

export function toPublicError(error: unknown): PublicError {
  const message = error instanceof Error ? error.message : 'Unknown error.';
  const lower = message.toLowerCase();
  if (lower.includes('payload too large')) return { code: 'payload_too_large', message };
  if (lower.includes('invalid blob')) return { code: 'invalid_blob_url', message };
  return { code: 'internal_error', message: 'Processing failed. Please retry.' };
}
