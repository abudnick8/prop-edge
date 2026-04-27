import { Request, Response, NextFunction } from "express";
import { verifyJWT, JWTPayload } from "./auth";

// Extend Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

// ── requireAuth ───────────────────────────────────────────────────────────────
// Must be logged in — any tier or no active sub
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Not logged in" });

  const user = verifyJWT(token);
  if (!user) return res.status(401).json({ error: "Session expired — please log in again" });

  req.user = user;
  next();
}

// ── requireBasic ──────────────────────────────────────────────────────────────
// Must have basic or pro tier (or be owner)
export function requireBasic(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.user) return;

    // Owner always passes
    if (req.user.isOwner) return next();

    if (req.user.tier !== "basic" && req.user.tier !== "pro") {
      return res.status(403).json({
        error: "Subscription required",
        requiredTier: "basic",
        upgradeUrl: "/upgrade",
      });
    }
    next();
  });
}

// ── requirePro ────────────────────────────────────────────────────────────────
// Must have pro tier (or be owner)
export function requirePro(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.user) return;

    // Owner always passes
    if (req.user.isOwner) return next();

    if (req.user.tier !== "pro") {
      return res.status(403).json({
        error: "Pro subscription required",
        requiredTier: "pro",
        upgradeUrl: "/upgrade",
      });
    }
    next();
  });
}

// ── optionalAuth ──────────────────────────────────────────────────────────────
// Attaches user if token present, but doesn't block unauthenticated requests
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    const user = verifyJWT(token);
    if (user) req.user = user;
  }
  next();
}
