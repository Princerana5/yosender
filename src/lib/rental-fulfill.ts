import { getRentalPool, saveRentalPool, getRentals, saveRentals, getAccounts, saveAccounts } from "./db";

// Fulfill a rental order (free claim or paid): marks the pool account rented +
// creates tg account + rental record. Idempotent per (user, pool account) for
// free claims (same account can't be claimed twice) and per orderId for paid.
export function fulfillRentalOrder(order: { orderId: string; userId: string; poolAccountId: string; price: number; payCurrency?: string | null; isFree?: boolean }) {
  // Free-claim path: one active rental per (user, pool account). A retry of the
  // same claim must return the existing rental instead of erroring.
  if (order.isFree) {
    const rentalsNow = getRentals();
    const mine = rentalsNow.find((r: any) => r.userId === order.userId && r.poolAccountId === order.poolAccountId && r.status === "active");
    if (mine) {
      return { already: true, rental: mine, tgAccountId: (mine as any).tgAccountId };
    }
  }
  const rentals = getRentals();
  const existing = rentals.find((r: any) => (r as any).orderId === order.orderId);
  if (existing) {
    return { already: true, rental: existing, tgAccountId: (existing as any).tgAccountId };
  }

  const pool = getRentalPool();
  const p = pool.find((x) => x.id === order.poolAccountId);
  if (!p) throw new Error("Rented sender no longer exists");
  if (p.status !== "available") throw new Error("Sender was just rented by someone else — try another");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const rentedAt = now.toISOString();

  p.status = "rented";
  p.rentedBy = order.userId;
  p.rentedAt = rentedAt;
  p.expiresAt = expiresAt;
  saveRentalPool(pool);

  const accounts = getAccounts();
  const tgAccountId = `rent_${p.id}_${Date.now().toString(36)}`;
  const tgAcc: any = {
    id: tgAccountId,
    userId: order.userId,
    phone: p.phone,
    username: p.username,
    displayName: p.displayName + " · Rented",
    firstName: p.firstName,
    session: p.session || `__RENTAL_MOCK__${p.id}`,
    status: "connected",
    createdAt: rentedAt,
    isRental: true,
    rentalId: "",
    rentalExpiresAt: expiresAt,
    rentalPoolId: p.id,
  };
  accounts.push(tgAcc);
  saveAccounts(accounts);

  const rental: any = {
    id: `rental_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    userId: order.userId,
    poolAccountId: p.id,
    tgAccountId,
    phone: p.phone,
    username: p.username,
    displayName: p.displayName,
    firstName: p.firstName,
    price: order.price,
    rentedAt,
    expiresAt,
    status: "active",
    isFree: !!order.isFree,
    orderId: order.orderId,
    payCurrency: order.payCurrency || null,
    paidVia: order.isFree ? "free-claim" : "crypto",
  };
  tgAcc.rentalId = rental.id;
  saveAccounts(accounts);
  rentals.unshift(rental);
  saveRentals(rentals);

  return { already: false, rental, tgAccountId };
}

export function poolAccountIdFromOrder(order: any): string | null {
  if (order?.raw?.poolAccountId) return String(order.raw.poolAccountId);
  const m = String(order?.planId || "").match(/^rental:(.+)$/);
  if (m) return m[1];
  return null;
}
