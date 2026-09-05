import { Suspense } from "react";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { db, publicUser } from "@/lib/db";
import Feed from "./feed";

export const dynamic = "force-dynamic";

export default async function AppHome({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const jar = await cookies();
  const token = jar.get("nevx_session")?.value;
  const sess = token ? await verifyToken(token) : null;
  const d = db();
  const u = sess ? d.users.find((x) => x.id === sess.sub) : null;
  const sp = await searchParams;
  const groups = d.groups.filter((g) => g.active).sort((a, b) => a.order - b.order);

  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading marketplace…</div>}>
      <Feed
        groups={groups}
        categories={d.categories}
        me={u ? { ...publicUser(u), email: u.email } : null}
        initialGroup={sp.group && groups.some((g) => g.id === sp.group) ? sp.group : "g_world"}
      />
    </Suspense>
  );
}
