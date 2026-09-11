import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login(): JSX.Element {
  const [email, setEmail] = useState('admin@8xtelsmpp.com');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const nav = useNavigate();

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr('');
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'login failed');
      localStorage.setItem('xtel_token', body.token);
      nav('/');
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={submit} className="card w-96 space-y-4">
        <div>
          <div className="text-2xl font-bold text-brand">8xtelSMPP</div>
          <div className="text-sm text-gray-400">Enterprise Messaging Gateway</div>
        </div>
        {err && <div className="text-sm text-red-400">{err}</div>}
        <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn w-full" type="submit">Sign in</button>
      </form>
    </div>
  );
}
