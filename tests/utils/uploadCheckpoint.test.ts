import { describe, it, expect } from 'vitest';
import { formatUploadCheckpoint } from '../../utils/uploadCheckpoint';

describe('formatUploadCheckpoint', () => {
  it('returns null when there are no uploaded files', () => {
    expect(formatUploadCheckpoint(0)).toBeNull();
  });

  it('formats a singular upload message', () => {
    expect(formatUploadCheckpoint(1)).toBe('Uploaded 1 file successfully.');
  });

  it('formats a plural upload message', () => {
    expect(formatUploadCheckpoint(3)).toBe('Uploaded 3 files successfully.');
  });
});
