import { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, DataTable, StatusBadge, Modal } from '../components';

interface OtpTemplate {
  id: string; name: string; template_ref: string | null; sender_id: string;
  content: string; otp_placeholder: string; status: string; is_default: boolean;
  usage_7d?: string; client_maps?: string;
  created_at: string; updated_at: string;
}

const blank = {
  name: '', template_ref: '', sender_id: '', content: '',
  otp_placeholder: '{OTP}', status: 'active', is_default: false,
};

export default function OtpTemplates(): JSX.Element {
  const [rows, setRows] = useState<OtpTemplate[]>([]);
  const [editing, setEditing] = useState<OtpTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [testTpl, setTestTpl] = useState<OtpTemplate | null>(null);
  const [sample, setSample] = useState('Your OTP is 777988');
  const [testRes, setTestRes] = useState<Record<string, unknown> | null>(null);

  const load = (): void => {
    api<{ templates: OtpTemplate[] }>('/routes/otp-templates')
      .then((r) => setRows(r.templates))
      .catch(() => undefined);
  };
  useEffect(load, []);

  function openCreate(): void {
    setForm({ ...blank });
    setErr('');
    setCreating(true);
  }

  function openEdit(t: OtpTemplate): void {
    setForm({
      name: t.name, template_ref: t.template_ref ?? '', sender_id: t.sender_id,
      content: t.content, otp_placeholder: t.otp_placeholder, status: t.status,
      is_default: t.is_default,
    });
    setErr('');
    setEditing(t);
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const body = {
        ...form,
        template_ref: form.template_ref || null,
      };
      if (editing) {
        await api(`/routes/otp-templates/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api('/routes/otp-templates', { method: 'POST', body: JSON.stringify(body) });
      }
      setEditing(null);
      setCreating(false);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(t: OtpTemplate): Promise<void> {
    await api(`/routes/otp-templates/${t.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: t.status === 'active' ? 'inactive' : 'active' }),
    }).catch(() => undefined);
    load();
  }

  async function remove(t: OtpTemplate): Promise<void> {
    if (!window.confirm(`Delete template "${t.name}"?\n\nRoutes using it as default will reject OTP traffic with a clear reason (never an inactive template).`)) return;
    await api(`/routes/otp-templates/${t.id}`, { method: 'DELETE' }).catch(() => undefined);
    load();
  }

  async function runTest(): Promise<void> {
    if (!testTpl) return;
    setTestRes(null);
    try {
      const r = await api<Record<string, unknown>>(`/routes/otp-templates/${testTpl.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ message: sample }),
      });
      setTestRes(r);
    } catch (e) {
      setTestRes({ ok: false, reason: (e as Error).message });
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="OTP Templates"
        sub="Vendor-approved Sender IDs + DLT text for India HSP OTP transformation · only active templates route"
        actions={<button className="btn !py-1.5 !text-xs" onClick={openCreate}>+ Add Template</button>}
      />
      <DataTable
        keyOf={(t) => t.id}
        rows={rows}
        empty="No OTP templates yet — add the first approved template."
        columns={[
          {
            key: 'name', label: 'Template',
            render: (t) => (
              <div>
                <div className="font-semibold">
                  {t.name}
                  {t.is_default && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand/10 text-emerald-300 border border-brand/25 align-middle">DEFAULT ★</span>}
                </div>
                <div className="text-[11px] text-muted font-mono">{t.template_ref ?? 'no DLT ref'}</div>
              </div>
            ),
          },
          { key: 'sender_id', label: 'Approved SID', mono: true },
          {
            key: 'content', label: 'Content',
            render: (t) => <span className="text-xs max-w-[320px] block truncate" title={t.content}>{t.content}</span>,
          },
          { key: 'otp_placeholder', label: 'Placeholder', mono: true },
          { key: 'status', label: 'Status', render: (t) => <StatusBadge status={t.status === 'active' ? 'delivered' : 'failed'} /> },
          {
            key: 'usage_7d', label: 'Used 7d', right: true,
            render: (t) => <span className="tabular-nums">{Number(t.usage_7d ?? 0).toLocaleString()}</span>,
          },
          {
            key: 'actions', label: '',
            render: (t) => (
              <span className="flex gap-1 justify-end">
                <button className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => { setTestTpl(t); setSample('Your OTP is 777988'); setTestRes(null); }}>Test</button>
                <button className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => openEdit(t)}>Edit</button>
                <button className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => void toggle(t)}>
                  {t.status === 'active' ? 'Deactivate' : 'Activate'}
                </button>
                {!t.is_default && (
                  <button
                    className="btn-ghost !py-1 !px-2 !text-xs" title="Mark as default"
                    onClick={() => { void api(`/routes/otp-templates/${t.id}`, { method: 'PATCH', body: JSON.stringify({ is_default: true }) }).then(load); }}
                  >
                    ★
                  </button>
                )}
                <button className="btn-ghost !py-1 !px-2 !text-xs text-red-300" onClick={() => void remove(t)}>Delete</button>
              </span>
            ),
          },
        ]}
      />

      {(creating || editing) && (
        <Modal title={editing ? `Edit — ${editing.name}` : 'Add OTP template'} onClose={() => { setCreating(false); setEditing(null); }}>
          <form onSubmit={(e) => void save(e)} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Template name</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} placeholder="Login OTP" required />
              </div>
              <div>
                <label className="label">Template ID / DLT ref</label>
                <input className="input font-mono" value={form.template_ref} onChange={(e) => setForm({ ...form, template_ref: e.target.value })} maxLength={120} placeholder="1207…" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Approved Sender ID</label>
                <input className="input font-mono" value={form.sender_id} onChange={(e) => setForm({ ...form, sender_id: e.target.value })} maxLength={21} placeholder="MYBANK" required />
              </div>
              <div>
                <label className="label">OTP placeholder</label>
                <input className="input font-mono" value={form.otp_placeholder} onChange={(e) => setForm({ ...form, otp_placeholder: e.target.value })} maxLength={20} required />
              </div>
            </div>
            <div>
              <label className="label">Template content (must contain the placeholder)</label>
              <textarea className="input min-h-[90px]" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} maxLength={1000} placeholder="Your login OTP is {OTP}. Valid for 10 minutes." required />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={form.status === 'active'} onChange={(e) => setForm({ ...form, status: e.target.checked ? 'active' : 'inactive' })} className="accent-emerald-500" />
                Active
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="accent-emerald-500" />
                Default ★
              </label>
            </div>
            {err && <div className="text-sm text-red-300">{err}</div>}
            <div className="flex gap-2">
              <button className="btn flex-1" type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save' : 'Add template'}</button>
              <button className="btn-ghost" type="button" onClick={() => { setCreating(false); setEditing(null); }}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {testTpl && (
        <Modal title={`Test — ${testTpl.name}`} onClose={() => setTestTpl(null)}>
          <div className="space-y-3 text-sm">
            <div>
              <label className="label">Sample client message</label>
              <textarea className="input min-h-[70px]" value={sample} onChange={(e) => setSample(e.target.value)} />
            </div>
            <button className="btn w-full" onClick={() => void runTest()}>Extract + render</button>
            {testRes && (
              testRes.ok ? (
                <div className="rounded-lg bg-brand/5 border border-brand/25 p-3 space-y-1.5 text-[13px]">
                  <div>Extracted OTP: <b className="font-mono text-emerald-300">{String(testRes.otp)}</b></div>
                  <div>Vendor SID: <b className="font-mono">{String(testRes.vendor_sender)}</b></div>
                  <div className="rounded bg-ink border border-line p-2.5 whitespace-pre-wrap">{String(testRes.vendor_text)}</div>
                </div>
              ) : (
                <div className="text-sm text-red-300 bg-danger/10 border border-danger/25 rounded-lg px-3 py-2">
                  {String(testRes.reason ?? 'extraction failed')}
                </div>
              )
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
