import { queryOne } from '@8xtel/core';

// ── OTP Sender ID & Template Prefix Mapping (India HSP) ─────────────────────
// Route-level, opt-in: only runs when routes.otp_transform_enabled is true.
// Client submits any SID + free-form OTP text → we extract the 4–6 digit OTP,
// stamp it into the admin-approved template, swap the SID to the approved one,
// and forward the TRANSFORMED message to the HSP vendor. Client message-id,
// DLR flow, billing and accounting are untouched (they key off internal_id).

export interface OtpTemplate {
  id: string;
  name: string;
  sender_id: string;
  content: string;
  otp_placeholder: string;
}

export interface OtpTransform {
  otp: string;
  template: OtpTemplate;
  finalSource: string;
  finalText: string;
}

// Keyword-anchored patterns first (OTP/code/PIN/verification…), then a bare
// 4–6 digit fallback. Never matches 7+ digit runs (amounts, phone fragments).
const ANCHORED = /(?:otp|one[\s-]?time[\s-]?password|verification(?:\s+code)?|verify(?:\s+code)?|passcode|\bcode\b|\bpin\b)[\s:.\-is]*?(\d{4,6})(?!\d)/i;
const BARE = /(?<!\d)(\d{4,6})(?!\d)/;

export function extractOtp(text: string): string | null {
  const t = text ?? '';
  const anchored = ANCHORED.exec(t);
  if (anchored?.[1]) return anchored[1];
  const bare = BARE.exec(t);
  return bare?.[1] ?? null;
}

interface RouteOtpConfig {
  otp_transform_enabled: boolean;
  otp_default_template_id: string | null;
  otp_on_no_otp: string;
  otp_on_no_template: string;
}

export async function loadRouteOtpConfig(routeId: string): Promise<RouteOtpConfig | null> {
  return queryOne<RouteOtpConfig>(
    `SELECT otp_transform_enabled, otp_default_template_id,
            COALESCE(otp_on_no_otp,'reject') AS otp_on_no_otp,
            COALESCE(otp_on_no_template,'reject') AS otp_on_no_template
     FROM routes WHERE id=$1`,
    [routeId],
  );
}

/** Resolve template: per-client mapping wins, else route default. Active only. */
export async function resolveOtpTemplate(
  routeId: string,
  clientId: string,
  defaultTemplateId: string | null,
): Promise<OtpTemplate | null> {
  const mapped = await queryOne<OtpTemplate>(
    `SELECT t.id, t.name, t.sender_id, t.content, t.otp_placeholder
     FROM route_otp_clients m JOIN otp_templates t ON t.id=m.template_id
     WHERE m.route_id=$1 AND m.client_id=$2 AND t.status='active'`,
    [routeId, clientId],
  );
  if (mapped) return mapped;
  if (!defaultTemplateId) return null;
  return queryOne<OtpTemplate>(
    `SELECT id, name, sender_id, content, otp_placeholder FROM otp_templates
     WHERE id=$1 AND status='active'`,
    [defaultTemplateId],
  );
}

/**
 * Attempt the OTP transformation. Returns:
 *  - { ok:true, transform } → caller swaps source/text and persists audit cols
 *  - { ok:false, reason } → caller rejects OR passes through per route config
 */
export async function tryOtpTransform(
  routeId: string,
  clientId: string,
  source: string,
  text: string,
): Promise<
  | { ok: true; transform: OtpTransform }
  | { ok: false; reason: string; fallback: 'reject' | 'passthrough' }
> {
  const cfg = await loadRouteOtpConfig(routeId);
  if (!cfg?.otp_transform_enabled) {
    return { ok: false, reason: 'otp transform not enabled', fallback: 'passthrough' };
  }
  const otp = extractOtp(text);
  if (!otp) {
    return {
      ok: false,
      reason: `no 4-6 digit OTP found in message from ${source}`,
      fallback: cfg.otp_on_no_otp === 'passthrough' ? 'passthrough' : 'reject',
    };
  }
  const template = await resolveOtpTemplate(routeId, clientId, cfg.otp_default_template_id);
  if (!template) {
    return {
      ok: false,
      reason: 'no active OTP template configured for route',
      fallback: cfg.otp_on_no_template === 'passthrough' ? 'passthrough' : 'reject',
    };
  }
  if (!template.sender_id?.trim()) {
    return { ok: false, reason: `OTP template "${template.name}" has no approved Sender ID`, fallback: 'reject' };
  }
  if (!template.content.includes(template.otp_placeholder)) {
    return { ok: false, reason: `OTP template "${template.name}" missing placeholder ${template.otp_placeholder}`, fallback: 'reject' };
  }
  const finalText = template.content.split(template.otp_placeholder).join(otp);
  // Vendor length guard: GSM-7 160 / unicode 70 single-segment ceiling is too
  // strict for templates — allow concatenated (1000 chars) but never garbage.
  if (!finalText.trim() || finalText.length > 1000) {
    return { ok: false, reason: 'transformed OTP message length invalid', fallback: 'reject' };
  }
  return {
    ok: true,
    transform: { otp, template, finalSource: template.sender_id.trim(), finalText },
  };
}
