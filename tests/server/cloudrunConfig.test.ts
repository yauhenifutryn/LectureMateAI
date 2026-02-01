import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const configPath = path.join(process.cwd(), 'cloudrun/tsconfig.json');

describe('cloud run tsconfig', () => {
  it('includes api and server sources', async () => {
    const raw = await readFile(configPath, 'utf8');
    const config = JSON.parse(raw) as { include?: string[]; compilerOptions?: { outDir?: string } };

    expect(config.include).toContain('../api/**/*.ts');
    expect(config.include).toContain('../server/**/*.ts');
    expect(config.compilerOptions?.outDir).toBe('../build');
  });
});
