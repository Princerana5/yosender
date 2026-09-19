import { query } from '@8xtel/core';

// ── FX: EUR base — no live refresh needed ─────────────────────────────────────
// EUR is the only money currency (plus unitless SMS credits). With a single
// currency there is nothing to convert, so the refresher is a no-op kept for
// API compat (POST /billing/currencies/refresh returns the EUR row).
// If more currencies return one day, re-point FX_URL at a live source.

export async function refreshFxRates(reason: string): Promise<{ updated: string[]; skipped: string[] }> {
  console.log(`[fx] refresh (${reason}) skipped — EUR base, nothing to convert`);
  return { updated: [], skipped: ['EUR'] };
}

/** Start the hourly refresh loop. No-op while EUR is the sole currency. */
export function startFxRefresh(): void {
  // Intentionally empty — kept so billing.ts needs no changes if FX returns.
}
