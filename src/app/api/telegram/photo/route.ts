import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/tg";
import { getSessionForReq } from "@/lib/tg-accounts";
export async function GET(req: NextRequest) {
  const s = getSessionForReq(req);
  if (!s) return NextResponse.json({ error: "Not connected" }, { status: 401 });
  try {
    const c = getClient(s); await c.connect();
    const me: any = await c.getMe();
    const buf: any = await c.downloadProfilePhoto(me);
    await c.disconnect();
    if (!buf?.length) return NextResponse.json({ photo: null });
    const b64 = Buffer.from(buf).toString("base64");
    return NextResponse.json({ photo: `data:image/jpeg;base64,${b64}` });
  } catch (e: any) { return NextResponse.json({ photo: null }); }
}
