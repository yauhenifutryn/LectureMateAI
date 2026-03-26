import { describe, expect, it } from 'vitest';
import { buildAccessFieldState } from '../../utils/accessField';

describe('buildAccessFieldState', () => {
  it('masks the admin password by default and offers a reveal control', () => {
    const state = buildAccessFieldState('admin', false);

    expect(state.inputType).toBe('password');
    expect(state.toggleLabel).toBe('Show admin password');
    expect(state.placeholder).toBe('Enter admin password');
  });

  it('masks the demo code by default and offers a reveal control', () => {
    const state = buildAccessFieldState('demo', false);

    expect(state.inputType).toBe('password');
    expect(state.toggleLabel).toBe('Show access code');
    expect(state.placeholder).toBe('Enter demo code');
  });

  it('switches to plain text when reveal is enabled', () => {
    const state = buildAccessFieldState('demo', true);

    expect(state.inputType).toBe('text');
    expect(state.toggleLabel).toBe('Hide access code');
  });
});
