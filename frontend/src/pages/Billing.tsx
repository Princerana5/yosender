import { useEffect, useState } from 'react';
import { api, fmtMoney } from '../api';

interface Wallet {
  client_id: string; client_name: string; balance: string; credit_limit: string; currency: string;
}
interface Tx {
  id: number; client_name: string; type: string; amount: string; balance_after: string; description: string; created_at: string;
}

export default function Billing(): JSX.Element {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);

  const load = (): void => {
    api<{ wallets: Wallet[] }>('/billing/wallets').then((r) => setWallets(r.wallets)).catch(() => undefined);
    api<{ transactions: Tx[] }>('/billing/transactions').then((r) => setTxs(r.transactions)).catch(() => undefined);
  };
  useEffect(load, []);

  async function topup(clientId: string): Promise<void> {
    const amount = Number(prompt('Top-up amount (USD):', '100'));
    if (!amount || amount <= 0) return;
    await api(`/billing/wallets/${clientId}/topup`, { method: 'POST', body: JSON.stringify({ amount }) });
    load();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Wallets & ledger</h1>
      <div className="grid md:grid-cols-3 gap-3">
        {wallets.map((w) => (
          <div key={w.client_id} className="card">
            <div className="font-bold">{w.client_name}</div>
            <div className="text-2xl font-bold text-brand">{fmtMoney(w.balance)}</div>
            <div className="text-xs text-gray-400">Credit limit {fmtMoney(w.credit_limit)}</div>
            <button className="btn mt-2" onClick={() => topup(w.client_id)}>Top up</button>
          </div>
        ))}
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="tbl w-full">
          <thead><tr><th>Time</th><th>Client</th><th>Type</th><th>Amount</th><th>Balance after</th><th>Description</th></tr></thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id}>
                <td className="text-xs">{new Date(t.created_at).toLocaleString()}</td>
                <td>{t.client_name}</td>
                <td>{t.type}</td>
                <td className={Number(t.amount) < 0 ? 'text-red-400' : 'text-green-400'}>{fmtMoney(t.amount)}</td>
                <td>{fmtMoney(t.balance_after)}</td>
                <td className="text-xs">{t.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
