import { createHash } from "node:crypto";
import path from "node:path";

export type CloudflareAccessConfig = {
  required: boolean;
  teamDomain?: string;
  audience?: string;
  allowedEmails: Set<string>;
};

export type AppConfig = {
  host: string;
  port: number;
  mcpPath: string;
  vaultPath: string;
  vaultName: string;
  readOnly: boolean;
  allowedOrigins: Set<string>;
  allowedHosts: Set<string>;
  rateLimitPerMinute: number;
  mcpAppResourceDomain?: string;
  cloudflareAccess: CloudflareAccessConfig;
};

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isExplicitlySet(value: string | undefined): boolean {
  return value != null && value.trim() !== "";
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost" ||
    normalized === "::ffff:127.0.0.1"
  );
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535; got ${value}`);
  }
  return port;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer; got ${value}`);
  }
  return parsed;
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTeamDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return undefined;
  return trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function deriveClaudeResourceDomain(publicMcpUrl: string | undefined): string | undefined {
  const url = normalizeOptionalValue(publicMcpUrl);
  if (!url) return undefined;
  return `${createHash("sha256").update(url).digest("hex").slice(0, 32)}.claudemcpcontent.com`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN ?? env.TEAM_DOMAIN);
  const audience = env.CF_ACCESS_AUD ?? env.POLICY_AUD;
  const accessRequiredFallback = Boolean(teamDomain && audience);
  const host = env.HOST ?? "127.0.0.1";
  const required = parseBool(env.CF_ACCESS_REQUIRED, accessRequiredFallback);

  // Fail closed: if Cloudflare Access is required, the verifier inputs must be present
  // so the server cannot boot into a state where it accepts unverifiable tokens.
  if (required && (!teamDomain || !audience)) {
    throw new Error(
      "CF_ACCESS_REQUIRED is enabled but CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are not both set. " +
        "Provide both, or set CF_ACCESS_REQUIRED=false to run without authentication."
    );
  }

  // Fail closed: refuse to expose an unauthenticated vault on a non-loopback interface
  // unless the operator explicitly opted out via CF_ACCESS_REQUIRED. This prevents a
  // partially-configured deploy from silently serving the whole vault to the network.
  if (!required && !isExplicitlySet(env.CF_ACCESS_REQUIRED) && !isLoopbackHost(host)) {
    throw new Error(
      `Refusing to start unauthenticated on non-loopback host "${host}". ` +
        "Configure Cloudflare Access (CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD), " +
        "or set CF_ACCESS_REQUIRED=false to explicitly run without authentication."
    );
  }

  return {
    host,
    port: parsePort(env.PORT),
    mcpPath: env.MCP_PATH ?? "/mcp",
    vaultPath: path.resolve(env.VAULT_PATH ?? process.cwd()),
    vaultName: env.VAULT_NAME ?? "Obsidian",
    readOnly: parseBool(env.READ_ONLY, true),
    allowedOrigins: new Set(splitCsv(env.ALLOWED_ORIGINS)),
    allowedHosts: new Set(splitCsv(env.ALLOWED_HOSTS).map((host) => host.toLowerCase())),
    rateLimitPerMinute: parseNonNegativeInt(env.RATE_LIMIT_PER_MINUTE, 300),
    mcpAppResourceDomain:
      normalizeOptionalValue(env.MCP_APP_RESOURCE_DOMAIN) ??
      deriveClaudeResourceDomain(env.MCP_PUBLIC_URL ?? env.PUBLIC_MCP_URL),
    cloudflareAccess: {
      required,
      teamDomain,
      audience,
      allowedEmails: new Set(splitCsv(env.CF_ACCESS_ALLOWED_EMAILS).map((email) => email.toLowerCase()))
    }
  };
}
