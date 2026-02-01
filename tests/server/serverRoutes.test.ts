import { describe, it, expect } from 'vitest';
import { resolveStaticPath } from '../../server/index';

describe('cloud run server routes', () => {
  it('maps root path to index.html', () => {
    const resolved = resolveStaticPath('/');
    expect(resolved).toContain('index.html');
  });
});
