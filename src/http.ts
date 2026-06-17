import { randomUUID } from "node:crypto";

import express, { type Express, type Request, type RequestHandler, type Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { cloudflareAccessMiddleware } from "./cloudflare-access.js";
import type { AppConfig } from "./config.js";
import type { ManagedSyncSnapshot } from "./managed-sync.js";
import { createObsidianMcpServer } from "./mcp.js";
import { originGuard } from "./origin-guard.js";
import { Vault } from "./vault.js";

type McpSession = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
};

type SseSession = {
  transport: SSEServerTransport;
  server: McpServer;
};

export type AppHandle = {
  app: Express;
  sessions: Map<string, McpSession>;
  sseSessions: Map<string, SseSession>;
};

export type AppOptions = {
  managedSync?: {
    snapshot(): ManagedSyncSnapshot;
    isReady(): boolean;
  };
};

const ssePath = "/sse";
const sseMessagesPath = "/messages";

export function createApp(config: AppConfig, options: AppOptions = {}): AppHandle {
  const app = express();
  const sessions = new Map<string, McpSession>();
  const sseSessions = new Map<string, SseSession>();
  const accessGuard = cloudflareAccessMiddleware(config.cloudflareAccess);
  const browserOriginGuard = originGuard(config.allowedOrigins);
  const rateLimiter = rateLimitGuard(config.rateLimitPerMinute);

  if (config.cloudflareAccess.required && config.cloudflareAccess.allowedEmails.size === 0) {
    console.warn(
      "cloudflare_access_no_email_allowlist",
      "CF_ACCESS_ALLOWED_EMAILS is empty: every identity your Cloudflare Access policy admits can use this vault. " +
        "Set CF_ACCESS_ALLOWED_EMAILS to restrict access to specific users."
    );
  }

  app.disable("x-powered-by");
  installRequestDiagnostics(app, config);
  app.use(express.json({ limit: "8mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      name: "obsidian-mcp",
      readOnly: config.readOnly,
      sync: options.managedSync?.snapshot() ?? disabledSyncSnapshot(config.sync.requiredForReady),
      cloudflareAccessRequired: config.cloudflareAccess.required
    });
  });

  app.get("/ready", async (_req, res) => {
    try {
      await new Vault(config.vaultPath).assertReady();
      const sync = options.managedSync?.snapshot() ?? disabledSyncSnapshot(config.sync.requiredForReady);
      if (config.sync.enabled && config.sync.requiredForReady && !options.managedSync?.isReady()) {
        res.status(503).json({
          ok: false,
          vaultPath: config.vaultPath,
          sync,
          error: sync.lastError ?? `Managed sync is not ready: ${sync.state}`
        });
        return;
      }
      res.json({ ok: true, vaultPath: config.vaultPath, sync });
    } catch (error) {
      res.status(503).json({
        ok: false,
        error: error instanceof Error ? error.message : "Vault readiness check failed"
      });
    }
  });

  registerOAuthCompatibilityRoutes(app, config);

  app.options(config.mcpPath, browserOriginGuard, (_req, res) => {
    res.status(204).end();
  });

  app.post(config.mcpPath, rateLimiter, browserOriginGuard, accessGuard, async (req, res) => {
    await handleMcpPost(config, sessions, req, res);
  });

  app.get(config.mcpPath, rateLimiter, browserOriginGuard, accessGuard, async (req, res) => {
    await handleMcpSessionRequest(sessions, req, res);
  });

  app.delete(config.mcpPath, rateLimiter, browserOriginGuard, accessGuard, async (req, res) => {
    await handleMcpSessionRequest(sessions, req, res);
  });

  app.get(ssePath, rateLimiter, browserOriginGuard, accessGuard, async (req, res) => {
    await handleSseConnect(config, sseSessions, req, res);
  });

  app.post(sseMessagesPath, rateLimiter, browserOriginGuard, accessGuard, async (req, res) => {
    await handleSseMessage(sseSessions, req, res);
  });

  return { app, sessions, sseSessions };
}

function disabledSyncSnapshot(requiredForReady: boolean): ManagedSyncSnapshot {
  return {
    enabled: false,
    requiredForReady,
    state: "disabled",
    running: false,
    configured: false,
    ready: true,
    restartCount: 0
  };
}

/**
 * Fixed-window, in-memory per-client rate limiter. Keyed by Cloudflare's
 * `cf-connecting-ip` when present, otherwise the socket address. A limit of 0
 * disables limiting. State is process-local; for multi-instance deployments
 * rely on Cloudflare's own rate limiting in front of the origin.
 */
function rateLimitGuard(perMinute: number): RequestHandler {
  if (perMinute <= 0) {
    return (_req, _res, next) => next();
  }

  const windowMs = 60_000;
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
    const now = Date.now();
    const key = clientKey(req);

    // Opportunistically drop expired buckets so the map cannot grow unbounded
    // under a stream of distinct client keys.
    if (hits.size > 10_000) {
      for (const [entryKey, entry] of hits) {
        if (entry.resetAt <= now) hits.delete(entryKey);
      }
    }

    const existing = hits.get(key);
    if (!existing || existing.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (existing.count >= perMinute) {
      const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    existing.count += 1;
    next();
  };
}

function clientKey(req: Request): string {
  return firstForwardedValue(req.header("cf-connecting-ip")) ?? req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function installRequestDiagnostics(app: Express, config: AppConfig) {
  app.use((req, res, next) => {
    if (!shouldLogRequest(req, config)) {
      next();
      return;
    }

    const started = Date.now();
    res.on("finish", () => {
      console.log(
        "http_request",
        JSON.stringify({
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - started,
          userAgent: truncateHeader(req.header("user-agent")),
          accept: truncateHeader(req.header("accept")),
          contentType: truncateHeader(req.header("content-type")),
          origin: truncateHeader(req.header("origin")),
          hasAccessJwt: Boolean(req.header("cf-access-jwt-assertion")),
          hasAuthorizationBearer: req.header("authorization")?.trim().toLowerCase().startsWith("bearer ") ?? false,
          hasMcpSessionId: Boolean(req.header("mcp-session-id")),
          hasCloudflareIdentity: Boolean(req.cloudflareAccess),
          ...describeJsonRpcRequest(req.body),
          cfRay: truncateHeader(req.header("cf-ray"))
        })
      );
    });

    next();
  });
}

function shouldLogRequest(req: Request, config: AppConfig) {
  return (
    req.path === config.mcpPath ||
    req.path === `${config.mcpPath}/` ||
    req.path === ssePath ||
    req.path === sseMessagesPath ||
    req.path.startsWith("/.well-known/") ||
    req.path === "/authorize" ||
    req.path === "/oauth/authorize"
  );
}

function truncateHeader(value: string | undefined) {
  if (!value) return undefined;
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

function describeJsonRpcRequest(body: unknown) {
  const messages = jsonRpcMessages(body);
  const methods = messages
    .map((message) => message.method)
    .filter((method): method is string => typeof method === "string");
  const toolNames = messages
    .map((message) => {
      const params = objectValue(message.params);
      return typeof params?.name === "string" ? params.name : undefined;
    })
    .filter((name): name is string => Boolean(name));
  const resourceUris = messages
    .map((message) => {
      const params = objectValue(message.params);
      return typeof params?.uri === "string" ? params.uri : undefined;
    })
    .filter((uri): uri is string => Boolean(uri));
  const initialize = messages.find((message) => message.method === "initialize");
  const initializeParams = objectValue(initialize?.params);
  const clientInfo = objectValue(initializeParams?.clientInfo);
  const protocolVersion =
    typeof initializeParams?.protocolVersion === "string" ? initializeParams.protocolVersion : undefined;
  const appsMimeTypes = describeMcpAppsMimeTypes(initializeParams?.capabilities);

  return {
    mcpMethods: methods.length > 0 ? methods : undefined,
    mcpToolNames: toolNames.length > 0 ? toolNames : undefined,
    mcpResourceUris: resourceUris.length > 0 ? resourceUris : undefined,
    initializeClientName: typeof clientInfo?.name === "string" ? clientInfo.name : undefined,
    initializeClientVersion: typeof clientInfo?.version === "string" ? clientInfo.version : undefined,
    initializeProtocolVersion: protocolVersion,
    initializeMcpAppsSupported: appsMimeTypes?.includes("text/html;profile=mcp-app"),
    initializeMcpAppsMimeTypes: appsMimeTypes
  };
}

function jsonRpcMessages(body: unknown): Array<{ method?: unknown; params?: unknown }> {
  const messages = Array.isArray(body) ? body : [body];
  return messages.map((message) => objectValue(message) ?? {});
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function describeMcpAppsMimeTypes(capabilities: unknown): string[] | undefined {
  const capabilityObject = objectValue(capabilities);
  const extensions = objectValue(capabilityObject?.extensions);
  const uiExtension = objectValue(extensions?.["io.modelcontextprotocol/ui"]);
  const mimeTypes = uiExtension?.mimeTypes;

  if (!Array.isArray(mimeTypes)) return undefined;
  const stringMimeTypes = mimeTypes.filter((mimeType): mimeType is string => typeof mimeType === "string");
  return stringMimeTypes.length > 0 ? stringMimeTypes : undefined;
}

function registerOAuthCompatibilityRoutes(app: Express, config: AppConfig) {
  app.get(["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"], (_req, res) => {
    const metadata = authorizationServerMetadata(config);
    if (!metadata) {
      res.status(404).json({ error: "cloudflare_access_oauth_not_configured" });
      return;
    }

    res.json(metadata);
  });

  app.get(
    [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/cloudflare-access-protected-resource/mcp"
    ],
    (req, res) => {
      const resource = mcpResourceUrl(req, config);
      const authorizationServers = config.cloudflareAccess.teamDomain ? [config.cloudflareAccess.teamDomain] : [];
      res.json({
        resource,
        protected: config.cloudflareAccess.required,
        authorization_servers: authorizationServers,
        authentication_methods: [
          {
            name: "oauth",
            description: "Authenticate through Cloudflare Access Managed OAuth."
          }
        ]
      });
    }
  );

  app.get(["/authorize", "/oauth/authorize"], (req, res) => {
    const metadata = authorizationServerMetadata(config);
    if (!metadata) {
      res.status(404).json({ error: "cloudflare_access_oauth_not_configured" });
      return;
    }

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (Array.isArray(value)) {
        for (const item of value) appendQueryParam(params, key, item);
      } else {
        appendQueryParam(params, key, value);
      }
    }

    if (!params.has("resource")) {
      params.set("resource", mcpResourceUrl(req, config));
    }

    res.redirect(302, `${metadata.authorization_endpoint}?${params.toString()}`);
  });
}

function authorizationServerMetadata(config: AppConfig) {
  const teamDomain = config.cloudflareAccess.teamDomain;
  if (!teamDomain) return undefined;

  return {
    issuer: teamDomain,
    authorization_endpoint: `${teamDomain}/cdn-cgi/access/oauth/authorization`,
    token_endpoint: `${teamDomain}/cdn-cgi/access/oauth/token`,
    revocation_endpoint: `${teamDomain}/cdn-cgi/access/oauth/revoke`,
    registration_endpoint: `${teamDomain}/cdn-cgi/access/oauth/registration`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    code_challenge_methods_supported: ["S256"]
  };
}

function appendQueryParam(params: URLSearchParams, key: string, value: unknown) {
  if (typeof value === "string") {
    params.append(key, value);
  }
}

function mcpResourceUrl(req: Request, config: AppConfig) {
  const requestedHost = firstForwardedValue(req.header("x-forwarded-host")) ?? req.header("host");
  const host = trustedHost(requestedHost, config) ?? `${config.host}:${config.port}`;
  const proto = firstForwardedValue(req.header("x-forwarded-proto")) ?? (req.secure ? "https" : req.protocol);
  return new URL(config.mcpPath, `${proto}://${host}`).toString();
}

// Only echo a client-supplied (and therefore spoofable) Host/X-Forwarded-Host
// back into OAuth metadata when it matches the configured allow-list. Without an
// allow-list we trust the header as before, since the public host is unknown.
function trustedHost(requestedHost: string | undefined, config: AppConfig): string | undefined {
  if (!requestedHost) return undefined;
  if (config.allowedHosts.size === 0) return requestedHost;
  const hostname = requestedHost.split(":")[0]?.toLowerCase();
  if (config.allowedHosts.has(requestedHost.toLowerCase()) || (hostname && config.allowedHosts.has(hostname))) {
    return requestedHost;
  }
  return undefined;
}

function firstForwardedValue(value: string | undefined) {
  return value?.split(",")[0]?.trim() || undefined;
}

async function handleMcpPost(
  config: AppConfig,
  sessions: Map<string, McpSession>,
  req: Request,
  res: Response
) {
  try {
    const sessionId = getSessionId(req);
    const existingSession = sessionId ? sessions.get(sessionId) : undefined;
    if (existingSession) {
      await existingSession.transport.handleRequest(req, res, req.body);
      return;
    }

    if (containsInitializeRequest(req.body)) {
      await handleStatefulMcpInitialize(config, sessions, req, res);
      return;
    }

    if (sessionId) {
      console.warn("mcp_session_not_found_fallback", JSON.stringify({ sessionId }));
    }

    await handleStatelessMcpPost(config, req, res);
  } catch (error) {
    sendInternalError(res, error);
  }
}

async function handleStatefulMcpInitialize(
  config: AppConfig,
  sessions: Map<string, McpSession>,
  req: Request,
  res: Response
) {
  const server = createObsidianMcpServer(config, req.cloudflareAccess);
  let transport: StreamableHTTPServerTransport;
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { transport, server });
      console.log("mcp_session_initialized", JSON.stringify({ sessionId, sessions: sessions.size }));
    },
    onsessionclosed: (sessionId) => {
      sessions.delete(sessionId);
      console.log("mcp_session_closed", JSON.stringify({ sessionId, sessions: sessions.size }));
    },
    ...streamableHttpSecurityOptions(config)
  });

  transport.onclose = () => {
    const sessionId = transport.sessionId;
    if (sessionId) {
      sessions.delete(sessionId);
      console.log("mcp_transport_closed", JSON.stringify({ sessionId, sessions: sessions.size }));
    }
  };

  transport.onerror = (error) => {
    console.error("mcp_transport_error", error);
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

async function handleStatelessMcpPost(
  config: AppConfig,
  req: Request,
  res: Response
) {
    const server = createObsidianMcpServer(config, req.cloudflareAccess);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      ...streamableHttpSecurityOptions(config)
    });

    res.on("close", () => {
      void transport.close().catch((error) => console.error("mcp_transport_close_error", error));
      void server.close().catch((error) => console.error("mcp_server_close_error", error));
    });

    transport.onerror = (error) => {
      console.error("mcp_transport_error", error);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
}

function streamableHttpSecurityOptions(config: AppConfig) {
  return {
    // Validate the Host/Origin headers when an allow-list is configured, blocking
    // DNS-rebinding attacks that try to reach the origin under an unexpected name.
    enableDnsRebindingProtection: config.allowedHosts.size > 0 || config.allowedOrigins.size > 0,
    allowedHosts: config.allowedHosts.size > 0 ? [...config.allowedHosts] : undefined,
    allowedOrigins: config.allowedOrigins.size > 0 ? [...config.allowedOrigins] : undefined
  };
}

function containsInitializeRequest(body: unknown) {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some((message) => isInitializeRequest(message));
}

async function handleMcpSessionRequest(sessions: Map<string, McpSession>, req: Request, res: Response) {
  try {
    const sessionId = getSessionId(req);
    if (!sessionId) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).send("Session not found");
      return;
    }

    await session.transport.handleRequest(req, res);
  } catch (error) {
    sendInternalError(res, error);
  }
}

async function handleSseConnect(
  config: AppConfig,
  sseSessions: Map<string, SseSession>,
  _req: Request,
  res: Response
) {
  const server = createObsidianMcpServer(config, _req.cloudflareAccess);
  const transport = new SSEServerTransport(sseMessagesPath, res);
  const sessionId = transport.sessionId;
  sseSessions.set(sessionId, { transport, server });
  console.log("mcp_sse_session_initialized", JSON.stringify({ sessionId, sessions: sseSessions.size }));

  transport.onclose = () => {
    sseSessions.delete(sessionId);
    console.log("mcp_sse_session_closed", JSON.stringify({ sessionId, sessions: sseSessions.size }));
  };

  transport.onerror = (error) => {
    console.error("mcp_sse_transport_error", error);
  };

  try {
    await server.connect(transport);
  } catch (error) {
    sseSessions.delete(sessionId);
    sendInternalError(res, error);
  }
}

async function handleSseMessage(sseSessions: Map<string, SseSession>, req: Request, res: Response) {
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
  if (!sessionId) {
    res.status(400).send("Missing sessionId");
    return;
  }

  const session = sseSessions.get(sessionId);
  if (!session) {
    res.status(404).send("Unknown SSE session");
    return;
  }

  try {
    await session.transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      sendInternalError(res, error);
    }
  }
}

function getSessionId(req: Request): string | undefined {
  const header = req.headers["mcp-session-id"];
  if (Array.isArray(header)) return header[0];
  return header;
}

function sendInternalError(res: Response, error: unknown) {
  console.error("MCP request failed:", error);
  if (res.headersSent) return;

  res.status(500).json({
    jsonrpc: "2.0",
    error: {
      code: -32603,
      message: "Internal server error"
    },
    id: null
  });
}
