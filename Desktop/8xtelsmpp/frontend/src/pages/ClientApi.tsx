import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, DataTable, EmptyState, Icon } from '../components';

interface ClientOpt {
  id: string;
  name: string;
  system_id: string;
}

interface ApiKey {
  id: string;
  key_prefix: string;
  label: string | null;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

function sampleCode(kind: 'curl' | 'php' | 'python' | 'js', key: string, base: string): string {
  const url = `${base}/client/v1/send`;
  if (kind === 'curl') {
    return `curl -X POST ${url} \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"from":"SENDER","to":"919876543210","text":"Hello via API"}'`;
  }
  if (kind === 'php') {
    return `<?php\n$ch = curl_init('${url}');\ncurl_setopt_array($ch, [\n  CURLOPT_POST => true,\n  CURLOPT_RETURNTRANSFER => true,\n  CURLOPT_HTTPHEADER => [\n    'Authorization: Bearer ${key}',\n    'Content-Type: application/json',\n  ],\n  CURLOPT_POSTFIELDS => json_encode([\n    'from' => 'SENDER',\n    'to' => '919876543210',\n    'text' => 'Hello via API',\n  ]),\n]);\n$res = curl_exec($ch);\necho $res;`;
  }
  if (kind === 'js') {
    return `const res = await fetch('${url}', {\n  method: 'POST',\n  headers: {\n    'Authorization': 'Bearer ${key}',\n    'Content-Type': 'application/json',\n  },\n  body: JSON.stringify({\n    from: 'SENDER',\n    to: '919876543210',\n    text: 'Hello via API',\n  }),\n});\nconsole.log(res.status, await res.json());`;
  }
  return `import requests\n\nr = requests.post(\n    "${url}",\n    headers={"Authorization": "Bearer ${key}"},\n    json={"from": "SENDER", "to": "919876543210",\n          "text": "Hello via API"},\n    timeout=15,\n)\nprint(r.status_code, r.json())`;
}

export default function ClientApi(): JSX.Element {
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [clientId, setClientId] = useState('');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<{ value: string; prefix: string } | null>(null);
  const [label, setLabel] = useState('');
  const [sample, setSample] = useState<'curl' | 'php' | 'python' | 'js'>('curl');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<{ clients: ClientOpt[] }>('/clients').then((r) => setClients(r.clients)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!clientId) {
      setKeys([]);
      return;
    }
    api<{ keys: ApiKey[] }>(`/clients/${clientId}/api-keys`).then((r) => setKeys(r.keys)).catch(() => undefined);
  }, [clientId]);

  async function createKey(): Promise<void> {
    if (!clientId) return;
    setMsg('');
    try {
      const r = await api<{ key: { value: string; key_prefix: string } }>(`/clients/${clientId}/api-keys`, {
        method: 'POST',
        body: JSON.stringify({ label: label || 'default' }),
      });
      setNewKey({ value: r.key.value, prefix: r.key.key_prefix });
      setLabel('');
      api<{ keys: ApiKey[] }>(`/clients/${clientId}/api-keys`).then((k) => setKeys(k.keys)).catch(() => undefined);
    } catch (e) {
      setMsg(`Create failed: ${(e as Error).message}`);
    }
  }

  async function toggleKey(k: ApiKey): Promise<void> {
    try {
      await api(`/clients/${clientId}/api-keys/${k.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !k.is_active }),
      });
      setKeys((ks) => ks.map((x) => (x.id === k.id ? { ...x, is_active: !x.is_active } : x)));
    } catch (e) {
      setMsg(`Update failed: ${(e as Error).message}`);
    }
  }

  async function deleteKey(k: ApiKey): Promise<void> {
    if (!window.confirm(`Revoke API key ${k.key_prefix}…? Apps using it stop working immediately.`)) return;
    try {
      await api(`/clients/${clientId}/api-keys/${k.id}`, { method: 'DELETE' });
      setKeys((ks) => ks.filter((x) => x.id !== k.id));
    } catch (e) {
      setMsg(`Revoke failed: ${(e as Error).message}`);
    }
  }

  const base = typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') + '/api' : '/api';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Client HTTP API"
        sub="API keys for downstream clients · send SMS over HTTPS, DLRs via callback"
      />

      <div className="card card-pad flex flex-wrap gap-2 items-end">
        <div className="w-64">
          <label className="label">Client</label>
          <select className="input" value={clientId} onChange={(e) => { setClientId(e.target.value); setNewKey(null); setMsg(''); }}>
            <option value="">Select a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.system_id})</option>)}
          </select>
        </div>
        {clientId && (
          <>
            <div className="w-52">
              <label className="label">Key label</label>
              <input className="input" placeholder="website / app" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <button className="btn" onClick={() => void createKey()}><Icon name="plus" size={14} /> New key</button>
          </>
        )}
      </div>

      {msg && <div className="text-sm text-red-300">{msg}</div>}

      {newKey && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
          <div className="text-sm text-emerald-300 font-semibold mb-1">New key — copy now, shown once:</div>
          <div className="font-mono text-sm break-all select-all">{newKey.value}</div>
        </div>
      )}

      {clientId ? (
        <DataTable
          keyOf={(r) => r.id}
          rows={keys}
          empty="No API keys yet — create one above."
          columns={[
            { key: 'key_prefix', label: 'Key', mono: true, render: (r) => <span>{r.key_prefix}…</span> },
            { key: 'label', label: 'Label', render: (r) => r.label ?? <span className="text-muted">—</span> },
            {
              key: 'is_active', label: 'Status',
              render: (r) => (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.is_active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-400'}`}>
                  {r.is_active ? 'active' : 'revoked'}
                </span>
              ),
            },
            {
              key: 'last_used_at', label: 'Last used',
              render: (r) => <span className="text-xs text-muted">{r.last_used_at ? new Date(r.last_used_at).toLocaleString() : 'never'}</span>,
            },
            {
              key: 'actions', label: '',
              render: (r) => (
                <span className="flex gap-1 justify-end">
                  <button className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => void toggleKey(r)}>
                    {r.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn-ghost !py-1 !px-2 !text-xs text-red-300" onClick={() => void deleteKey(r)}>Revoke</button>
                </span>
              ),
            },
          ]}
        />
      ) : (
        <EmptyState icon="users" title="Pick a client" sub="API keys are issued per client account." />
      )}

      {clientId && (
        <div className="card card-pad space-y-3">
          <div className="flex items-center justify-between">
            <div className="card-title">Integration sample</div>
            <div className="flex gap-1.5">
              {(['curl', 'php', 'python', 'js'] as const).map((s) => (
                <button key={s} onClick={() => setSample(s)}
                  className={`btn-ghost !py-1 !px-2.5 !text-xs ${sample === s ? '!border-brand/50 !text-emerald-300' : ''}`}>
                  {s === 'curl' ? 'cURL' : s === 'php' ? 'PHP' : s === 'python' ? 'Python' : 'JS'}
                </button>
              ))}
            </div>
          </div>
          <pre className="text-xs font-mono bg-ink border border-line rounded-lg p-3 overflow-x-auto whitespace-pre">
            {sampleCode(sample, newKey?.value ?? '<API_KEY>', base)}
          </pre>
          <div className="text-[11px] text-muted space-y-1">
            <div><span className="font-mono">POST /client/v1/send</span> — single · <span className="font-mono">POST /client/v1/send-bulk</span> — up to 5000 (to: array or comma-list)</div>
            <div><span className="font-mono">GET /client/v1/status/:id</span> — delivery status · <span className="font-mono">GET /client/v1/balance</span> — wallet · <span className="font-mono">GET /client/v1/docs?format=markdown</span> — self-serve docs for the client</div>
            <div>DLRs: set the client's callback URL (Clients → edit) or pass <span className="font-mono">dlr_url</span> per request — we POST {'{message_id, status, ts}'} on every status change.</div>
          </div>
        </div>
      )}
    </div>
  );
}
