import { query } from '@8xtel/core';

// ── FX auto-refresh: live USD→EUR/INR rates ─────────────────────────────────
// Source: open.er-api.com free tier (no key, ~1 req/hour is far under limits).
// Response: { result:"success", rates:{ EUR:0.85, INR:88.1, ... } } — units of
// foreign currency per 1 USD. We store the INVERSE (USD per 1 foreign unit)
// because rate_to_usd means "multiply native amount → USD".
//
// Cadence: hourly, plus once at boot (delayed so pools are ready). Failures
// are logged, never thrown — the panel keeps serving the last-known rates.
// Manual edits via PATCH /billing/currencies/:code set source='manual' and
// are left alone by the refresher only in the sense that the next hourly run
// overwrites them — the audit log records who changed what.

const FX_URL = process.env.FX_RATES_URL ?? 'https://open.er-api.com/v6/latest/USD';
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
      const perUsd = Number(body.rates[code]);
      if (!perUsd || perUsd <= 0) {
        skipped.push(code);
        continue;
      }
      const rateToUsd = +(1 / perUsd).toFixed(8);
      await query(
        `UPDATE fx_rates SET rate_to_usd=$1, source='live', refreshed_at=now(), updated_at=now()
         WHERE code=$2`,
        [rateToUsd, code],
      );
      updated.push(`${code}=${rateToUsd}`);
    }
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
