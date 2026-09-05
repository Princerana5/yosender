import fs from "fs";
import path from "path";
import type { DbShape, PublicUser, User } from "./types";
import { buildSeed } from "./seed";

const FILE = path.join(process.cwd(), "data", "nevx-db.json");

let cache: DbShape | null = null;

export function db(): DbShape {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    cache = JSON.parse(raw) as DbShape;
    if (!cache || !Array.isArray(cache.users)) throw new Error("bad db");
  } catch {
    cache = buildSeed();
    persist();
  }
  return cache;
}

export function persist(): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
  } catch {
    /* runtime FS may be read-only — memory cache still works */
  }
}

export function uid(prefix: string): string {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 7)
  );
}

export function nextDealId(): string {
  const d = db();
  d.seq = (d.seq || 10290) + 1;
  return `NVX-${d.seq}`;
}

export function publicUser(u: User): PublicUser {
  return {
    id: u.id,
    name: u.name,
    country: u.country,
    telegram: u.telegram,
    avatarColor: u.avatarColor,
    verified: u.verified,
    rating: u.rating,
    ratingCount: u.ratingCount,
    createdAt: u.createdAt,
  };
}

export function notify(
  userId: string,
  icon: string,
  text: string,
  link?: string
): void {
  const d = db();
  d.notifications.unshift({
    id: uid("nt"),
    userId,
    icon,
    text,
    read: false,
    link,
    createdAt: Date.now(),
  });
  // keep the list bounded
  if (d.notifications.length > 500) d.notifications.length = 500;
}
