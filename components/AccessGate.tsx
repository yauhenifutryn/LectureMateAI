import React, { useState } from 'react';
import type { AccessContext, AccessMode } from '../types';
import { Icons } from './Icon';

type AccessGateProps = {
  onAuthorize: (access: AccessContext) => void;
  defaultMode?: AccessMode;
  allowModeToggle?: boolean;
  redirectAdminTo?: string;
  redirectDemoTo?: string;
  error?: string | null;
};

const AccessGate: React.FC<AccessGateProps> = ({
  onAuthorize,
  defaultMode = 'demo',
  allowModeToggle = true,
  redirectAdminTo,
  redirectDemoTo,
  error
}) => {
  const [mode, setMode] = useState<AccessMode>(defaultMode);
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setIsSubmitting(true);
    setLocalError(null);
    try {
      if (mode === 'admin') {
        const response = await fetch('/api/admin/verify', {
          method: 'POST',
          headers: { Authorization: `Bearer ${trimmed}` }
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message || 'Invalid admin password.');
        }
      } else {
        const response = await fetch('/api/demo/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: trimmed })
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message || 'Invalid demo code.');
        }
      }

      onAuthorize({ mode, token: trimmed });
      if (mode === 'admin' && redirectAdminTo && typeof window !== 'undefined') {
        window.location.assign(redirectAdminTo);
      }
      if (mode === 'demo' && redirectDemoTo && typeof window !== 'undefined') {
        window.location.assign(redirectDemoTo);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Access denied.';
      setLocalError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const label = mode === 'admin' ? 'Admin Password' : 'Access Code';
  const placeholder = mode === 'admin' ? 'Enter admin password' : 'Enter demo code';
  const buttonLabel = mode === 'admin' ? 'Enter Control Room' : 'Unlock Access';

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-lg p-8">
        <div className="flex items-center justify-center mb-6">
          <div className="bg-primary-600 p-2 rounded-xl text-white">
            <Icons.Lock size={26} />
          </div>
        </div>

        <h2 className="text-2xl font-serif font-bold text-slate-900 text-center mb-2">
          Access Required
        </h2>
        <p className="text-sm text-slate-500 text-center mb-6">
          Enter a demo code to try the product, or use your admin password to unlock the control room.
        </p>

        {allowModeToggle && (
          <div className="grid grid-cols-2 gap-2 mb-6">
            <button
              type="button"
              onClick={() => setMode('demo')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                mode === 'demo'
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              Demo Code
            </button>
            <button
              type="button"
              onClick={() => setMode('admin')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                mode === 'admin'
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              Admin
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </label>
            <input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {(error || localError) && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error || localError}
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Verifying...' : buttonLabel}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AccessGate;
