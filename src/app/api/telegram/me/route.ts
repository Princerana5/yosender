import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/tg";
import { getSessionForReq } from "@/lib/tg-accounts";
export async function GET(req: NextRequest) {
  const s = getSessionForReq(req);
  if (!s) return NextResponse.json({ connected: false });
  try {
    const c = getClient(s); await c.connect(); const me: any = await c.getMe(); await c.disconnect();
    return NextResponse.json({ connected: true, username: me.username || me.firstName, firstName: me.firstName, lastName: me.lastName || "", phone: me.phone });
  } catch { return NextResponse.json({ connected: false }); }
}
