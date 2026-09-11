// Typed API client for the 8xtelSMPP backend.
const BASE = import.meta.env.VITE_API_URL ?? '';

export function token(): string | null {
  return localStorage.getItem('xtel_token');
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(token() ? { authorization: `Bearer ${token()}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('xtel_token');
    if (location.pathname !== '/login') location.href = '/login';
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const CUR_SYM: Record<string, string> = { USD: '$', EUR: '€', INR: '₹' };

export const fmtMoney = (
  n: number | string | null | undefined,
  currency = 'USD',
  decimals = 2,
): string => `${CUR_SYM[currency] ?? '$'}${Number(n ?? 0).toFixed(decimals)}`;

export const statusColor = (s: string): string => {
  switch (s) {
    case 'delivered':
    case 'active':
    case 'connected':
    case 'enabled':
      return 'bg-green-900 text-green-300';
    case 'submitted':
    case 'connecting':
    case 'pending':
      return 'bg-yellow-900 text-yellow-300';
    case 'failed':
    case 'blocked':
    case 'error':
      return 'bg-red-900 text-red-300';
    default:
      return 'bg-gray-800 text-gray-300';
  }
};
