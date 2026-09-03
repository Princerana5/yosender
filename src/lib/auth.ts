import jwt from "jsonwebtoken";
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
export function signToken(payload: object) { return jwt.sign(payload, SECRET, { expiresIn: "7d" }); }
export function verifyToken(t: string) { try { return jwt.verify(t, SECRET) as any; } catch { return null; } }
