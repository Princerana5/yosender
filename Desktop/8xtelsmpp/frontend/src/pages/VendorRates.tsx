import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtMoney } from '../api';
import { PageHeader, DataTable, StatusBadge } from '../components';

interface VendorRateRow {
  id: string;
  vendor_id: string;
  vendor_name: string;
  country_name: string | null;
  iso_code: string | null;
  prefix: string | null;
  operator: string | null;
  cost: string;
  currency?: string;
  updated_at?: string;
}

interface VendorOpt { id: string; name: string }

export default function VendorRates(): JSX.Element {
  const [rows, setRows] = useState<VendorRateRow[]>([]);
  const [vendors, setVendors] = useState<VendorOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterVendor, setFilterVendor] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    let dead = false;
    async function load(): Promise<void> {
      setLoading(true);
      try {
        const vRes = await api<{ vendors: VendorOpt[] }>('/vendors');
        if (dead) return;
        const vList = vRes.vendors ?? [];
        setVendors(vList.map((v) => ({ id: v.id, name: v.name })));
        // fetch rates per vendor in parallel (admin-only, small N)
        const all: VendorRateRow[] = [];
        const results = await Promise.all(
          vList.map(async (v) => {
            try {
              const r = await api<{ rates: Array<{ id: string; prefix: string | null; operator: string | null; country_name: string | null; cost: string; country_id: string | null; updated_at?: string }> }>(`/vendors/${v.id}`);
              return (r.rates ?? []).map((x) => ({
                id: x.id,
                vendor_id: v.id,
                vendor_name: v.name,
                country_name: x.country_name,
                iso_code: null,
                prefix: x.prefix,
                operator: x.operator,
                cost: x.cost,
                updated_at: x.updated_at,
              }));
            } catch { return []; }
          }),
        );
        for (const chunk of results) all.push(...chunk);
        // also try aggregated endpoint if present (fallback is per-vendor above)
        if (!dead) setRows(all);
      } finally {
        if (!dead) setLoading(false);
      }
    }
    load();
    return () => { dead = true; };
  }, []);

  const filtered = useMemo(() => {
    let out = rows;
    if (filterVendor) out = out.filter((r) => r.vendor_id === filterVendor);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      out = out.filter((r) =>
        r.vendor_name.toLowerCase().includes(s) ||
        (r.country_name ?? '').toLowerCase().includes(s) ||
        (r.prefix ?? '').toLowerCase().includes(s) ||
        (r.operator ?? '').toLowerCase().includes(s),
      );
    }
    return out;
  }, [rows, filterVendor, q]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vendor rates"
        sub={`${rows.length} termination costs · admin-only · cheapest cost per route drives margin`}
        actions={
          <Link to="/vendors" className="btn-ghost !py-1.5 !text-xs">Manage vendors →</Link>
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <select className="input !w-auto !py-1.5 !text-xs" value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)}>
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <input className="input !w-[220px] !py-1.5 !text-xs" placeholder="Search country / prefix / operator…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-xs text-muted ml-auto tabular-nums">{filtered.length} rates</span>
      </div>

      {loading ? (
        <div className="card card-pad text-sm text-muted py-10 text-center animate-pulse">Loading vendor rates…</div>
      ) : (
        <DataTable
          keyOf={(r) => r.id}
          rows={filtered}
          empty="No vendor rates yet. Add them per vendor in Vendors → Edit → Vendor rates."
          columns={[
            {
              key: 'vendor_name', label: 'Vendor',
              render: (r) => <span className="font-semibold">{String(r.vendor_name)}</span>,
            },
            {
              key: 'country_name', label: 'Country / Prefix',
              render: (r) => (
                <span className="text-xs">
                  <span className="font-medium">{String(r.country_name ?? '— default —')}</span>
                  {r.prefix ? <span className="ml-1.5 font-mono text-muted">{String(r.prefix)}</span> : null}
                  {r.operator ? <span className="ml-1.5 text-muted">{String(r.operator)}</span> : null}
                </span>
              ),
            },
            {
              key: 'cost', label: 'Cost / seg', right: true,
              render: (r) => <span className="font-mono font-semibold text-emerald-300">{fmtMoney(String(r.cost))}</span>,
            },
            {
              key: 'updated_at', label: 'Updated',
              render: (r) => <span className="text-xs text-muted whitespace-nowrap">{r.updated_at ? new Date(String(r.updated_at)).toLocaleDateString() : '—'}</span>,
            },
          ]}
        />
      )}

      <div className="text-[11px] text-muted">
        Edit costs in <Link to="/vendors" className="text-brand hover:underline">Vendors</Link> → Edit → Vendor rates. Route margin = cheapest vendor cost on that route vs client sell price.
      </div>
    </div>
  );
}
