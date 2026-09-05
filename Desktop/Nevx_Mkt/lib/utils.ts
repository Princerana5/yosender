export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtMoney(n: number): string {
  return "$" + Number(n || 0).toLocaleString("en-US");
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function flagUrl(code: string): string {
  if (code === "world") return "";
  return `https://flagcdn.com/w40/${code}.png`;
}

export const COUNTRIES = [
  "India",
  "United States",
  "China",
  "Germany",
  "United Arab Emirates",
  "United Kingdom",
  "Canada",
  "Australia",
  "Singapore",
  "Brazil",
  "France",
  "Japan",
  "Other",
];

export const DEAL_STATUSES = [
  "Pending",
  "Negotiating",
  "Payment Pending",
  "Payment Received",
  "In Progress",
  "Delivered",
  "Completed",
  "Cancelled",
  "Disputed",
] as const;

export const REPORT_REASONS = [
  "Spam",
  "Fraud",
  "Illegal products",
  "Misleading offer",
  "Harassment",
  "Fake listing",
];

export function dealBadge(status: string): string {
  switch (status) {
    case "Completed":
    case "Delivered":
      return "bg-emerald-100 text-emerald-700";
    case "Cancelled":
      return "bg-red-100 text-red-700";
    case "Disputed":
      return "bg-orange-100 text-orange-700";
    case "Negotiating":
    case "Pending":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-cyan-100 text-cyan-800";
  }
}
