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
  mcpAppResourceDomain?: string;
  cloudflareAccess: CloudflareAccessConfig;
};

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535; got ${value}`);
  }
  return port;
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

  return {
    host: env.HOST ?? "127.0.0.1",
    port: parsePort(env.PORT),
    mcpPath: env.MCP_PATH ?? "/mcp",
    vaultPath: path.resolve(env.VAULT_PATH ?? process.cwd()),
    vaultName: env.VAULT_NAME ?? "Obsidian",
    readOnly: parseBool(env.READ_ONLY, true),
    allowedOrigins: new Set(splitCsv(env.ALLOWED_ORIGINS)),
    mcpAppResourceDomain:
      normalizeOptionalValue(env.MCP_APP_RESOURCE_DOMAIN) ??
      deriveClaudeResourceDomain(env.MCP_PUBLIC_URL ?? env.PUBLIC_MCP_URL),
    cloudflareAccess: {
      required: parseBool(env.CF_ACCESS_REQUIRED, accessRequiredFallback),
      teamDomain,
      audience,
      allowedEmails: new Set(splitCsv(env.CF_ACCESS_ALLOWED_EMAILS).map((email) => email.toLowerCase()))
    }
  };
}
