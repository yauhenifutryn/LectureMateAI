import { describe, it, expect } from 'vitest';
import { validateBlobUrl } from '../../api/_lib/validateBlobUrl';

describe('validateBlobUrl', () => {
  it('accepts vercel blob host with allowed prefix', () => {
    const url = 'https://public.blob.vercel-storage.com/lecture/file.mp3';
    expect(() => validateBlobUrl(url, 'https://public.blob.vercel-storage.com/lecture/')).not.toThrow();
  });

  it('rejects non vercel blob hosts', () => {
    const url = 'https://example.com/file.mp3';
    expect(() => validateBlobUrl(url)).toThrow(/invalid blob host/i);
  });

  it('rejects url outside allowed prefix when provided', () => {
    const url = 'https://public.blob.vercel-storage.com/other/file.mp3';
    expect(() => validateBlobUrl(url, 'https://public.blob.vercel-storage.com/lecture/')).toThrow(/invalid blob prefix/i);
  });
});
