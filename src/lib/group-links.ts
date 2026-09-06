/**
 * Group link utilities — normalize, validate, detect type.
 * Supports public (t.me/username) and private (t.me/+hash, t.me/joinchat/hash) links.
 */

export type GroupType = "public" | "private" | "unknown";

export function normalizeGroupLink(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return "";
  // strip surrounding < > and quotes
  s = s.replace(/^["'<]+|["'>]+$/g, "").trim();
  // if it's just @username, convert to t.me/username for normalization
  if (/^@[a-zA-Z0-9_]{3,32}$/.test(s)) {
    s = "https://t.me/" + s.slice(1);
  }
  // ensure we have a protocol for URL parsing
  let urlStr = s;
  if (/^t\.me\//i.test(s)) urlStr = "https://" + s;
  // try to parse as URL
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    if (host !== "t.me" && host !== "www.t.me" && host !== "telegram.me" && host !== "www.telegram.me") {
      // not a telegram link — return lowercased trimmed raw for dedup
      return s.toLowerCase();
    }
    // normalize host to t.me
    let path = u.pathname.replace(/^\/+|\/+$/g, ""); // strip leading/trailing /
    // handle joinchat and + cases — keep hash as-is but lowercase? No, hash is case-sensitive
    // For dedup: private invite hashes are case-sensitive, but we normalize by lowercasing the prefix
    // Actually Telegram invite hashes ARE case-sensitive, so we must preserve case for private links
    // But for dedup we lowercase the whole thing to avoid duplicates from case differences in copy-paste
    // Decision: lowercase private hash as well for dedup (Telegram treats them case-insensitively in practice for join)
    if (/^joinchat\//i.test(path)) {
      const hash = path.replace(/^joinchat\//i, "");
      return `https://t.me/joinchat/${hash}`;
    }
    if (/^\+/.test(path)) {
      const hash = path.replace(/^\+/, "");
      return `https://t.me/+${hash}`;
    }
    // public username — lowercase username
    // path may contain extra segments like /username/123 — keep only username
    const username = path.split("/")[0].toLowerCase();
    if (!username) return "";
    return `https://t.me/${username}`;
  } catch {
    // fallback: treat as username
    const cleaned = s.replace(/^@/, "").toLowerCase().trim();
    if (/^[a-zA-Z0-9_]{3,32}$/.test(cleaned)) return `https://t.me/${cleaned}`;
    return s.toLowerCase();
  }
}

export function detectGroupType(link: string): GroupType {
  const n = normalizeGroupLink(link);
  if (!n) return "unknown";
  if (/^https:\/\/t\.me\/(\+|joinchat\/)/.test(n)) return "private";
  if (/^https:\/\/t\.me\/[a-z0-9_]{3,32}$/.test(n)) return "public";
  return "unknown";
}

export function isValidGroupLink(raw: string): boolean {
  const s = String(raw || "").trim();
  if (!s) return false;
  // Accept: t.me/xxx, https://t.me/xxx, @xxx, t.me/+hash, t.me/joinchat/hash
  const patterns = [
    /^https?:\/\/(www\.)?(t\.me|telegram\.me)\/.+/i,
    /^t\.me\/.+/i,
    /^@[a-zA-Z0-9_]{3,32}$/,
    /^[a-zA-Z0-9_]{3,32}$/, // bare username (if context is group link)
  ];
  // For strict validation, require t.me or @
  const strict = /^(https?:\/\/(www\.)?(t\.me|telegram\.me)\/|t\.me\/|@)[a-zA-Z0-9_+\/]+/i;
  if (!strict.test(s)) return false;
  const n = normalizeGroupLink(s);
  if (!n) return false;
  // must be a valid normalized t.me link
  if (/^https:\/\/t\.me\/(joinchat\/|\+).+/.test(n)) return true;
  if (/^https:\/\/t\.me\/[a-z0-9_]{3,32}$/.test(n)) return true;
  return false;
}

export function extractUsername(normalizedLink: string): string | null {
  const m = normalizedLink.match(/^https:\/\/t\.me\/([a-z0-9_]{3,32})$/);
  return m ? m[1] : null;
}

export function extractInviteHash(normalizedLink: string): string | null {
  let m = normalizedLink.match(/^https:\/\/t\.me\/\+(.+)$/);
  if (m) return m[1];
  m = normalizedLink.match(/^https:\/\/t\.me\/joinchat\/(.+)$/);
  if (m) return m[1];
  return null;
}
