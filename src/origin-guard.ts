import type { RequestHandler } from "express";

export function originGuard(allowedOrigins: Set<string>): RequestHandler {
  return (req, res, next) => {
    if (allowedOrigins.size === 0) {
      next();
      return;
    }

    const origin = req.header("origin");
    if (!origin) {
      next();
      return;
    }

    if (allowedOrigins.has(origin)) {
      next();
      return;
    }

    res.status(403).json({ error: "origin_not_allowed" });
  };
}

