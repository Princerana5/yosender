import { query } from '@8xtel/core';

// ── FX auto-refresh: live USDT→EUR/INR rates ─────────────────────────────────
// Base currency is USDT (Tether, USD-pegged 1:1). Source: open.er-api.com free
// tier (no key) with base=USDT. Response: { result:"success",
// rates:{ EUR:0.87, INR:96, ... } } — units of foreign currency per 1 USDT.
// We store the INVERSE (USDT per 1 foreign unit) because rate_to_usd means
// "multiply native amount → base" (column kept its name for compat).
//
// Cadence: hourly, plus once at boot (delayed so pools are ready). Failures
// are logged, never thrown — the panel keeps serving the last-known rates.
// Manual edits via PATCH /billing/currencies/:code set source='manual' and
// are overwritten by the next auto-refresh — the audit log records changes.

const FX_URL = process.env.FX_RATES_URL ?? 'https://open.er-api.com/v6/latest/USDT';
const INTERVAL_MS = Number(process.env.FX_REFRESH_INTERVAL_MS ?? 3_600_000);

export async function refreshFxRates(reason: string): Promise<{ updated: string[]; skipped: string[] }> {
  const updated: string[] = [];
  const skipped: string[] = [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(FX_URL, { signal: ctrl.signal });
    if (!res.ok) {
      console.warn(`[fx] refresh (${reason}) failed: http ${res.status}`);
      return { updated, skipped };
    }
    const body = (await res.json()) as {
      result?: string; rates?: Record<string, number>;
    };
    if (body.result !== 'success' || !body.rates) {
      console.warn(`[fx] refresh (${reason}) failed: bad payload`);
      return { updated, skipped };
    }
    for (const code of ['EUR', 'INR'] as const) {
      const perBase = Number(body.rates[code]);
      if (!perBase || perBase <= 0) {
        skipped.push(code);
        continue;
      }
      const rateToBase = +(1 / perBase).toFixed(8);
      await query(
        `UPDATE fx_rates SET rate_to_usd=$1, source='live', refreshed_at=now(), updated_at=now()
         WHERE code=$2`,
        [rateToBase, code],
      );
      updated.push(`${code}=${rateToBase}`);
    }
    // Base row always 1, just stamp it.
    await query(
      `UPDATE fx_rates SET rate_to_usd=1, source='live', refreshed_at=now(), updated_at=now()
       WHERE code='USDT'`,
    );
    if (updated.length) console.log(`[fx] refreshed (${reason}): ${updated.join(' ')}`);
  } catch (e) {
    console.warn(`[fx] refresh (${reason}) failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  return { updated, skipped };
}

/** Start the hourly refresh loop. Call once from API boot. */
export function startFxRefresh(): void {
  // Let pools/migrations settle before the first pull.
  setTimeout(() => {
    void refreshFxRates('boot');
  }, 30_000).unref?.();
  setInterval(() => {
    void refreshFxRates('hourly');
  }, INTERVAL_MS).unref?.();
}
