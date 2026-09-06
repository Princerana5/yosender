import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Normalizes the host behind nginx / Cloudflare so cookies, OAuth and
// NOWPayments callbacks always use the canonical https://<apex-domain> URL.
// - Forces apex (www.<domain> → <domain>), keeps all other hosts as-is
//   (VPS IP, localhost) so direct-IP checks keep working.
export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") || "").toLowerCase();

  // Generic www → apex: www.example.com → example.com (any domain).
  // Keeps VPS-IP / localhost untouched so direct-IP health checks work.
  if (host.startsWith("www.") && host.split(".").length >= 3) {
    const url = new URL(request.url);
    url.host = host.slice(4);
    url.port = "";
    if (process.env.NODE_ENV === "production") url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
