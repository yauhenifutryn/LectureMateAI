import type { AccessMode } from '../types';

export type AccessFieldState = {
  label: string;
  placeholder: string;
  inputType: 'password' | 'text';
  toggleLabel: string;
};

export function buildAccessFieldState(
  mode: AccessMode,
  isSecretVisible: boolean
): AccessFieldState {
  const isAdmin = mode === 'admin';
  const secretName = isAdmin ? 'admin password' : 'access code';

  return {
    label: isAdmin ? 'Admin Password' : 'Access Code',
    placeholder: isAdmin ? 'Enter admin password' : 'Enter demo code',
    inputType: isSecretVisible ? 'text' : 'password',
    toggleLabel: `${isSecretVisible ? 'Hide' : 'Show'} ${secretName}`
  };
}
