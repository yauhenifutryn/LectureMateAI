export type PublicError = {
  code: string;
  message: string;
};

export function toPublicError(error: unknown): PublicError {
  const message = error instanceof Error ? error.message : 'Unknown error.';
  const lower = message.toLowerCase();
  if (
    lower.includes('model') &&
    (lower.includes('not found') || lower.includes('not supported') || lower.includes('unsupported'))
  ) {
    return {
      code: 'model_unavailable',
      message: 'Selected Gemini model is unavailable. Choose another model.'
    };
  }
  if (lower.includes('file too large') || lower.includes('max upload bytes')) {
    return { code: 'file_too_large', message: 'File exceeds the allowed upload size.' };
  }
  if (lower.includes('payload too large')) return { code: 'payload_too_large', message };
  if (lower.includes('transcript missing')) {
    return { code: 'transcript_missing', message: 'Transcript is missing from model output.' };
  }
  if (lower.includes('empty response')) {
    return { code: 'empty_model_response', message: 'Gemini returned an empty response.' };
  }
  if (lower.includes('invalid blob')) return { code: 'invalid_blob_url', message };
  if (lower.includes('timed out')) {
    return { code: 'processing_timeout', message: 'Processing timed out. Please retry.' };
  }
  return { code: 'internal_error', message: 'Processing failed. Please retry.' };
}
