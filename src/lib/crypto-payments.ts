import fs from "fs";
import path from "path";

const DB_DIR = process.env.VERCEL ? path.join("/tmp", ".data") : path.join(process.cwd(), ".data");
const FILE = path.join(DB_DIR, "crypto_payments.json");

export type CryptoPayment = {
  id: string; // orderId
  orderId: string;
  invoiceId?: string | null;
  paymentId?: string | null;
  userId: string;
  userEmail: string;
  planId: string;
  billing: "daily" | "monthly";
  amountUsd: number;
  payCurrency?: string | null;
  priceCurrency: string;
  status: "waiting" | "confirming" | "confirmed" | "sending" | "partially_paid" | "finished" | "failed" | "refunded" | "expired";
  invoiceUrl?: string | null;
  licenseKey?: string | null;
  licenseKeyId?: string | null;
  createdAt: string;
  updatedAt: string;
  raw?: any;
};

function ensure() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]");
}
function read(): CryptoPayment[] {
  ensure();
  try { return JSON.parse(fs.readFileSync(FILE, "utf-8")); } catch { return []; }
}
function write(data: CryptoPayment[]) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

export function getCryptoPayments(): CryptoPayment[] { return read(); }
export function saveCryptoPayments(p: CryptoPayment[]) { write(p); }

export function findCryptoPayment(orderId: string): CryptoPayment | null {
  return read().find(x => x.orderId === orderId) || null;
}

export function upsertCryptoPayment(p: CryptoPayment) {
  const all = read();
  const idx = all.findIndex(x => x.orderId === p.orderId);
  if (idx >= 0) all[idx] = p;
  else all.unshift(p);
  write(all);
  return p;
}

export function updateCryptoPayment(orderId: string, patch: Partial<CryptoPayment>) {
  const all = read();
  const idx = all.findIndex(x => x.orderId === orderId);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
  write(all);
  return all[idx];
}
