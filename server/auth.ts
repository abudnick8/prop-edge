import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET || "ciq-dev-secret-change-in-production";
const JWT_EXPIRES = "30d";
const BCRYPT_ROUNDS = 10;

// ── JWT ──────────────────────────────────────────────────────────────────────

export interface JWTPayload {
  userId: number;
  email: string;
  tier: string | null;
  isOwner: boolean;
}

export function signJWT(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyJWT(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

// ── PIN hashing ───────────────────────────────────────────────────────────────

export async function hashPIN(pin: string): Promise<string> {
  return bcrypt.hash(pin.toUpperCase(), BCRYPT_ROUNDS);
}

export async function checkPIN(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin.toUpperCase(), hash);
}

// ── PIN validation ────────────────────────────────────────────────────────────

export function isValidPIN(pin: string): boolean {
  // 4 characters, alphanumeric only
  return /^[A-Za-z0-9]{4}$/.test(pin);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
