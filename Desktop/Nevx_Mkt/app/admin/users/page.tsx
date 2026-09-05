"use client";

import { useEffect, useState } from "react";
import { Avatar, Empty, toast } from "@/components/ui";
import { cx } from "@/lib/utils";

export default function AdminUsers() {
  const [users, setUsers] = useState<any[]>([]);
  const [q, setQ] = useState("");

  async function load() {
    const r = await fetch("/api/admin/manage?scope=users").then((x) => x.json());
    setUsers(r.users || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function patch(id: string, body: any) {
    const r = await fetch("/api/admin/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "user-status", id, ...body }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      toast("User updated.");
      load();
    } else toast(j.error || "Failed.", false);
  }

  const list = users.filter((u) =>
    `${u.name} ${u.email} ${u.country}`.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-black text-white">👥 Users ({users.length})</h1>
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search users…"
          className="rounded-full border border-[#134e32] bg-[#0a251b] px-4 py-2 text-sm text-white outline-none placeholder:text-[#4d7a5f] focus:border-[#00e676]/60"
        />
      </div>
      {list.length === 0 ? <Empty icon="👥" title="No users found" /> : (
        <div className="overflow-x-auto rounded-2xl border border-[#134e32] bg-[#0a251b]">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#134e32] text-[11px] uppercase tracking-wider text-[#4d7a5f]">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Country</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Posts</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} className="border-b border-[#0d2f22] last:border-0 hover:bg-[#0d2f22]/60">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={u.name} color={u.avatarColor} size={30} />
                      <div>
                        <div className="font-bold text-white">{u.name} {u.verified && <span className="text-neon">✔</span>}</div>
                        <div className="text-[11px] text-[#4d7a5f]">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[#b9e6c9]">{u.country}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={u.role}
                      disabled={u.role === "SUPER_ADMIN"}
                      onChange={(e) => patch(u.id, { role: e.target.value })}
                      className="rounded-lg border border-[#134e32] bg-[#061b12] px-2 py-1 text-xs font-bold text-white"
                    >
                      <option>USER</option><option>ADMIN</option>
                      {u.role === "SUPER_ADMIN" && <option>SUPER_ADMIN</option>}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-bold",
                      u.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : u.status === "SUSPENDED" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700")}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[#7fbd97]">📝{u.needs} 🏷️{u.offers}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {u.status === "ACTIVE" ? (
                        <button onClick={() => patch(u.id, { status: "SUSPENDED" })} className="rounded-lg bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">Suspend</button>
                      ) : (
                        <button onClick={() => patch(u.id, { status: "ACTIVE" })} className="rounded-lg bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-700">Activate</button>
                      )}
                      <button onClick={() => patch(u.id, { status: "BANNED" })} className="rounded-lg bg-red-100 px-2 py-1 text-[11px] font-bold text-red-600">Ban</button>
                      <button onClick={() => patch(u.id, { verified: !u.verified })} className="rounded-lg border border-[#00e676]/30 bg-[#00e676]/10 px-2 py-1 text-[11px] font-bold text-neon">
                        {u.verified ? "Unverify" : "Verify"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-[#4d7a5f]">🔒 Emails shown here are admin-only and never exposed to other users or the API.</p>
    </div>
  );
}
