import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('cloud run dockerfile', () => {
  it('includes build step for vite', async () => {
    const dockerfile = await readFile(path.join(process.cwd(), 'cloudrun/Dockerfile'), 'utf8');
    expect(dockerfile).toContain('npm run build');
  });
});
