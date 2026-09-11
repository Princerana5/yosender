import bcrypt from 'bcryptjs';
import { queryOne, query, getPool } from '@8xtel/core';

// ── Downstream bind authentication (§5–§6) ───────────────────────────────────
// Accept ONLY if: system_id ok, password ok, IP whitelisted, account active,
// balance/credit available. Logs every attempt (incl. rejected IPs).

export interface BindPrincipal {
  client_id: string;
  system_id: string;
  status: string;
  balance: string;
  credit_limit: string;
  tps_limit: number;
  bind_type: string;
}

export async function authenticateBind(
  systemId: string,
  password: string,
  remoteIp: string,
  bindType: string,
): Promise<{ ok: true; principal: BindPrincipal } | { ok: false; reason: string }> {
  const client = await queryOne<{
    id: string; system_id: string; password_hash: string; status: string;
    balance: string; credit_limit: string; tps_limit: number;
  }>('SELECT id, system_id, password_hash, status, balance, credit_limit, tps_limit FROM clients WHERE system_id=$1', [
    systemId,
  ]);

  const log = (result: string, reason: string, clientId?: string): void => {
    void getPool().query(
      'INSERT INTO smpp_logs (kind, client_id, ip, system_id, result, reason) VALUES ($1,$2,$3,$4,$5,$6)',
      [reason === 'ip_not_whitelisted' ? 'ip_reject' : 'auth', clientId ?? null, remoteIp, systemId, result, reason],
    );
  };

  if (!client) {
    log('reject', 'unknown_system_id');
    return { ok: false, reason: 'unknown system_id' };
  }
  const passOk = await bcrypt.compare(password, client.password_hash);
  if (!passOk) {
    log('reject', 'bad_password', client.id);
    return { ok: false, reason: 'bad password' };
  }
  // IP whitelist (§6)
  const ips = await query<{ ip: string }>(
    'SELECT ip FROM client_ips WHERE client_id=$1 AND enabled=true', [client.id],
  );
  if (ips.length > 0 && !ipAllowed(remoteIp, ips.map((r) => r.ip))) {
    log('reject', 'ip_not_whitelisted', client.id);
    return { ok: false, reason: 'IP not whitelisted' };
  }
  if (client.status !== 'active') {
    log('reject', `account_${client.status}`, client.id);
    return { ok: false, reason: `account ${client.status}` };
  }
  if (Number(client.balance) + Number(client.credit_limit) <= 0) {
    log('reject', 'insufficient_balance', client.id);
    return { ok: false, reason: 'insufficient balance' };
  }
  log('accept', `bind_${bindType}`, client.id);
  return {
    ok: true,
    principal: {
      client_id: client.id,
      system_id: client.system_id,
      status: client.status,
      balance: client.balance,
      credit_limit: client.credit_limit,
      tps_limit: client.tps_limit,
      bind_type: bindType,
    },
  };
}

/** Exact IP or CIDR match */
export function ipAllowed(remoteIp: string, allowed: string[]): boolean {
  const ip = remoteIp.replace(/^::ffff:/, '');
  for (const rule of allowed) {
    if (!rule.includes('/')) {
      if (rule === ip || rule === remoteIp) return true;
      continue;
    }
    const [base, bits] = rule.split('/');
    if (cidrContains(base, Number(bits), ip)) return true;
  }
  return false;
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function cidrContains(base: string, bits: number, ip: string): boolean {
  const b = ipToInt(base);
  const v = ipToInt(ip);
  if (b === null || v === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (b & mask) === (v & mask);
}
