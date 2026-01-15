import React, { useEffect, useState } from 'react';
import type { AccessContext } from '../types';
import AccessGate from './AccessGate';
import { Icons } from './Icon';

type AdminPanelProps = {
  access: AccessContext | null;
  onAccessChange: (access: AccessContext | null) => void;
};

type DemoCode = {
  code: string;
  remaining: number;
};

type AccessEvent = {
  at: string;
  mode: 'admin' | 'demo';
  action: 'process' | 'chat';
  code?: string;
};

const AdminPanel: React.FC<AdminPanelProps> = ({ access, onAccessChange }) => {
  const [codes, setCodes] = useState<DemoCode[]>([]);
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [uses, setUses] = useState('3');
  const [isLoading, setIsLoading] = useState(false);
  const [isEventsLoading, setIsEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);

  const adminToken = access?.mode === 'admin' ? access.token : null;

  const loadCodes = async () => {
    if (!adminToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/list', {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await response.json();
      if (response.status === 401) {
        onAccessChange(null);
        throw new Error(data?.error?.message || 'Unauthorized.');
      }
      if (!response.ok) {
        throw new Error(data?.error?.message || 'Unable to load codes.');
      }
      setCodes(data.codes || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load codes.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadEvents = async () => {
    if (!adminToken) return;
    setIsEventsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/events?limit=50', {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await response.json();
      if (response.status === 401) {
        onAccessChange(null);
        throw new Error(data?.error?.message || 'Unauthorized.');
      }
      if (!response.ok) {
        throw new Error(data?.error?.message || 'Unable to load events.');
      }
      setEvents(data.events || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load events.';
      setError(message);
    } finally {
      setIsEventsLoading(false);
    }
  };

  useEffect(() => {
    if (adminToken) {
      loadCodes();
      loadEvents();
    }
  }, [adminToken]);

  const handleGenerate = async () => {
    if (!adminToken) return;
    setIsLoading(true);
    setError(null);
    setLastGenerated(null);
    try {
      const parsedUses = Number.parseInt(uses, 10);
      const response = await fetch('/api/admin/generate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uses: Number.isFinite(parsedUses) ? parsedUses : 3 })
      });
      const data = await response.json();
      if (response.status === 401) {
        onAccessChange(null);
        throw new Error(data?.error?.message || 'Unauthorized.');
      }
      if (!response.ok) {
        throw new Error(data?.error?.message || 'Unable to generate code.');
      }
      setLastGenerated(data.code);
      await loadCodes();
      await loadEvents();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to generate code.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async (code: string) => {
    if (!adminToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/revoke', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code })
      });
      const data = await response.json();
      if (response.status === 401) {
        onAccessChange(null);
        throw new Error(data?.error?.message || 'Unauthorized.');
      }
      if (!response.ok) {
        throw new Error(data?.error?.message || 'Unable to revoke code.');
      }
      await loadCodes();
      await loadEvents();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to revoke code.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!adminToken) {
    return (
      <AccessGate
        onAuthorize={(next) => onAccessChange(next)}
        defaultMode="admin"
        error={error}
        allowModeToggle={false}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-serif font-bold text-slate-900">Control Room</h1>
            <p className="text-sm text-slate-500">
              Generate and manage demo access codes. Admin access is unlimited.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onAccessChange(null)}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            <Icons.LogOut size={16} />
            Lock Session
          </button>
        </header>

        <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="flex-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Uses Per Demo Code
              </label>
              <input
                value={uses}
                onChange={(event) => setUses(event.target.value)}
                className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              className="bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg"
              disabled={isLoading}
            >
              Generate Code
            </button>
          </div>

          {lastGenerated && (
            <div className="text-sm bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg px-3 py-2">
              New demo code: <span className="font-semibold">{lastGenerated}</span>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Active Demo Codes</h2>
            <button
              type="button"
              onClick={loadCodes}
              className="text-sm font-semibold text-primary-600 hover:text-primary-700"
            >
              Refresh
            </button>
          </div>

          {isLoading && codes.length === 0 ? (
            <p className="text-sm text-slate-500">Loading codes...</p>
          ) : codes.length === 0 ? (
            <p className="text-sm text-slate-500">No demo codes created yet.</p>
          ) : (
            <div className="space-y-3">
              {codes.map((code) => (
                <div
                  key={code.code}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-slate-200 rounded-lg px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{code.code}</div>
                    <div className="text-xs text-slate-500">
                      Remaining uses: <span className="font-semibold">{code.remaining}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevoke(code.code)}
                    className="text-xs font-semibold text-red-600 hover:text-red-700"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Usage Log</h2>
            <button
              type="button"
              onClick={loadEvents}
              className="text-sm font-semibold text-primary-600 hover:text-primary-700"
            >
              Refresh
            </button>
          </div>

          {isEventsLoading && events.length === 0 ? (
            <p className="text-sm text-slate-500">Loading events...</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-slate-500">No usage events recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {events.map((event, index) => (
                <div
                  key={`${event.at}-${index}`}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border border-slate-200 rounded-lg px-4 py-3 text-sm"
                >
                  <div>
                    <div className="font-semibold text-slate-800">
                      {event.mode === 'admin' ? 'Admin' : `Demo ${event.code || ''}`}
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(event.at).toLocaleString()} · {event.action}
                    </div>
                  </div>
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    {event.mode}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminPanel;
