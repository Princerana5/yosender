import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components';

const BASE = import.meta.env.VITE_API_URL ?? '';

export default function Login(): JSX.Element {
  const [email, setEmail] = useState('admin@8xtelsmpp.com');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Login failed');
      localStorage.setItem('xtel_token', body.token);
      nav('/');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen app-bg flex items-center justify-center p-4">
      <div className="w-full max-w-[880px] grid md:grid-cols-2 card overflow-hidden !p-0">
        {/* brand panel */}
        <div className="hidden md:flex flex-col justify-between p-8 bg-gradient-to-br from-branddim/40 via-panel to-panel relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: 'radial-gradient(rgba(16,185,129,.25) 1px, transparent 1px)',
              backgroundSize: '22px 22px',
            }}
          />
          <div className="relative flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand to-branddim flex items-center justify-center shadow-glow">
              <Icon name="bolt" size={20} className="text-white" />
            </div>
            <div className="font-extrabold text-lg tracking-tight">
              8xtel<span className="text-brand">SMPP</span>
            </div>
          </div>
          <div className="relative">
            <div className="text-2xl font-bold leading-snug tracking-tight">
              One gateway.
              <br />
              Every message, routed.
            </div>
            <p className="text-sm text-muted mt-3 leading-relaxed">
              SMPP aggregation with vendor failover, real-time DLR tracking, wallet billing and
              multi-channel routing — operated from a single console.
            </p>
            <div className="grid grid-cols-3 gap-2 mt-6 text-center">
              {[
                ['2775', 'SMPP binds'],
                ['5', 'Route modes'],
                ['24/7', 'DLR tracking'],
              ].map(([v, l]) => (
                <div key={l} className="rounded-lg border border-line bg-ink/60 px-2 py-3">
                  <div className="font-bold text-brand">{v}</div>
                  <div className="text-[10px] text-muted uppercase tracking-wider mt-0.5">{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="relative text-[11px] text-muted font-mono">smpp.8xtelsmpp.com:2775</div>
        </div>

        {/* form */}
        <form onSubmit={submit} className="p-8 space-y-5">
          <div>
            <div className="text-xl font-bold tracking-tight">Welcome back</div>
            <div className="text-sm text-muted mt-1">Sign in to the operations console</div>
          </div>
          {err && (
            <div className="text-sm text-red-300 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2.5">
              {err}
            </div>
          )}
          <div>
            <label className="label">Work email</label>
            <input className="input" placeholder="admin@8xtelsmpp.com" value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" placeholder="••••••••" value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <button className="btn w-full !py-2.5" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in to console'}
          </button>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <Icon name="shield" size={13} /> Protected by RBAC · audited · IP-restricted binds
          </div>
        </form>
      </div>
    </div>
  );
}
