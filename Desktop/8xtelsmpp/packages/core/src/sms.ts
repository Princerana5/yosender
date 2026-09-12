// ── SMS segment calculator + GSM normalizer (§15) ────────────────────────────
// Billing is per SEGMENT, and encoding decides segment size:
//   GSM-7: 160 chars single, 153 per part when concatenated
//   Unicode (UCS-2): 70 chars single, 67 per part when concatenated
// One non-GSM char (Turkish ş/ğ/İ/ı, emoji, smart quotes…) flips the WHOLE
// message to Unicode — this module detects that BEFORE sending so the user
// sees the true segment count and cost, with an optional normalizer that maps
// common non-GSM chars back to GSM equivalents to stay in 1 segment.

// GSM-7 basic alphabet (single chars)
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
// GSM-7 extension table (each costs 2 septets: ESC + char)
const GSM_EXT = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);

export type SmsEncoding = 'gsm7' | 'unicode';

export interface SegmentInfo {
  encoding: SmsEncoding;
  /** length in encoding units (septets for GSM-7, UTF-16 code units for UCS-2) */
  units: number;
  segments: number;
  charsLeft: number;
  /** chars that forced unicode, capped for display */
  nonGsmChars: string[];
  normalized: boolean;
}

export function analyzeSms(text: string): SegmentInfo {
  const nonGsm = new Set<string>();
  let units = 0;
  for (const ch of text) {
    if (GSM_BASIC.has(ch)) {
      units += 1;
    } else if (GSM_EXT.has(ch)) {
      units += 2;
    } else {
      nonGsm.add(ch);
    }
  }
  if (nonGsm.size > 0) {
    // UCS-2: length in UTF-16 code units (astral chars = surrogate pair = 2)
    let u16 = 0;
    for (let i = 0; i < text.length; i++) {
      const cp = text.codePointAt(i)!;
      u16 += cp > 0xffff ? 2 : 1;
      if (cp > 0xffff) i++;
    }
    const segments = u16 <= 70 ? 1 : Math.ceil(u16 / 67);
    return {
      encoding: 'unicode',
      units: u16,
      segments,
      charsLeft: segments === 1 ? 70 - u16 : segments * 67 - u16,
      nonGsmChars: [...nonGsm].slice(0, 12),
      normalized: false,
    };
  }
  const segments = units <= 160 ? 1 : Math.ceil(units / 153);
  return {
    encoding: 'gsm7',
    units,
    segments,
    charsLeft: segments === 1 ? 160 - units : segments * 153 - units,
    nonGsmChars: [],
    normalized: false,
  };
}

// Common non-GSM → GSM mappings (Turkish, smart quotes, dashes, symbols).
// Applied ONLY when the user opts in ("fit in 1 segment").
const NORMALIZE_MAP: Record<string, string> = {
  ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ç: 'c', Ç: 'C',
  ö: 'o', Ö: 'O', ü: 'u', Ü: 'U',
  '‘': "'", '’': "'", '‚': ',', '“': '"', '”': '"', '„': '"',
  '–': '-', '—': '-', '…': '...', '•': '*', '·': '.',
  ' ': ' ', ' ': ' ', ' ': ' ',
  '™': '(TM)', '®': '(R)', '©': '(c)', '°': 'o', '±': '+/-',
  '×': 'x', '÷': '/', '€': 'EUR', '£': 'GBP',
};

export function normalizeToGsm(text: string): { text: string; changed: string[] } {
  const changed = new Set<string>();
  let out = '';
  for (const ch of text) {
    if (GSM_BASIC.has(ch) || GSM_EXT.has(ch)) {
      out += ch;
      continue;
    }
    const rep = NORMALIZE_MAP[ch];
    if (rep !== undefined) {
      out += rep;
      changed.add(ch);
    } else {
      out += ch; // unmappable — stays unicode
    }
  }
  return { text: out, changed: [...changed] };
}

/** Parse bulk destinations: commas, newlines, semicolons, spaces. Dedupes. */
export function parseDestinations(raw: string, max = 50_000): { numbers: string[]; invalid: string[]; truncated: boolean } {
  const parts = raw.split(/[,;\s\n\r\t|]+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const numbers: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    const digits = p.startsWith('+') ? '+' + p.slice(1).replace(/\D/g, '') : p.replace(/\D/g, '');
    const digitCount = digits.replace(/\D/g, '').length;
    if (/^\+?\d{4,16}$/.test(digits) && digitCount >= 4 && digitCount <= 16) {
      if (!seen.has(digits)) {
        seen.add(digits);
        numbers.push(digits);
      }
    } else {
      invalid.push(p);
    }
    if (numbers.length >= max) break;
  }
  return { numbers, invalid: invalid.slice(0, 50), truncated: numbers.length >= max && parts.length > numbers.length };
}
