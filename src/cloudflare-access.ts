import type { RequestHandler } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import type { CloudflareAccessConfig } from "./config.js";

export type CloudflareAccessIdentity = {
  email?: string;
  subject?: string;
  claims: JWTPayload;
};

type AccessTokenSource = "cf-access-jwt-assertion" | "authorization-bearer";

declare global {
  namespace Express {
    interface Request {
      cloudflareAccess?: CloudflareAccessIdentity;
    }
  }
}

const jwksByTeamDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  const existing = jwksByTeamDomain.get(teamDomain);
  if (existing) return existing;

  const jwks = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", teamDomain));
  jwksByTeamDomain.set(teamDomain, jwks);
  return jwks;
}

function claimAsString(payload: JWTPayload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function accessTokenFromRequest(req: Parameters<RequestHandler>[0]): { token?: string; source?: AccessTokenSource } {
  const assertion = req.header("cf-access-jwt-assertion")?.trim();
  if (assertion) return { token: assertion, source: "cf-access-jwt-assertion" };

  const authorization = req.header("authorization")?.trim();
  const bearerPrefix = "bearer ";
  if (authorization?.toLowerCase().startsWith(bearerPrefix)) {
    const token = authorization.slice(bearerPrefix.length).trim();
    if (token) return { token, source: "authorization-bearer" };
  }

  return {};
}

function logAccessDenied(req: Parameters<RequestHandler>[0], reason: string, detail?: string) {
  console.warn(
    "cloudflare_access_denied",
    JSON.stringify({
      reason,
      detail,
      method: req.method,
      path: req.path,
      hasAccessJwt: Boolean(req.header("cf-access-jwt-assertion")),
      hasAuthorizationBearer: req.header("authorization")?.trim().toLowerCase().startsWith("bearer ") ?? false,
      cfRay: req.header("cf-ray")
    })
  );
}

export function cloudflareAccessMiddleware(config: CloudflareAccessConfig): RequestHandler {
  return async (req, res, next) => {
    if (!config.required) {
      return next();
    }

    if (!config.teamDomain || !config.audience) {
      res.status(500).json({
        error: "cloudflare_access_misconfigured",
        detail: "CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required when CF_ACCESS_REQUIRED=true"
      });
      return;
    }

    const accessToken = accessTokenFromRequest(req);
    if (!accessToken.token) {
      logAccessDenied(req, "missing_cloudflare_access_token");
      res.status(403).json({ error: "missing_cloudflare_access_token" });
      return;
    }

    try {
      const { payload } = await jwtVerify(accessToken.token, getJwks(config.teamDomain), {
        issuer: config.teamDomain,
        audience: config.audience
      });

      const email = claimAsString(payload, "email");
      if (config.allowedEmails.size > 0) {
        if (!email || !config.allowedEmails.has(email.toLowerCase())) {
          logAccessDenied(req, "cloudflare_access_email_not_allowed");
          res.status(403).json({ error: "cloudflare_access_email_not_allowed" });
          return;
        }
      }

      req.cloudflareAccess = {
        email,
        subject: payload.sub,
        claims: payload
      };
      next();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "JWT verification failed";
      logAccessDenied(req, "invalid_cloudflare_access_token", detail);
      res.status(403).json({
        error: "invalid_cloudflare_access_token",
        detail
      });
    }
  };
}

export const cloudflareAccessIdentityText = (identity: CloudflareAccessIdentity | undefined) => {
  if (!identity) return "Cloudflare Access identity is not required for this request.";
  return identity.email ?? identity.subject ?? "Cloudflare Access identity present.";
};
