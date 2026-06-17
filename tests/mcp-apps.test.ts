import { createServer, type Server } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NOTE_EDITOR_RESOURCE_URI } from "../src/apps/note-editor.js";
import { SEARCH_RESULTS_RESOURCE_URI } from "../src/apps/search-results.js";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/http.js";

let tempDir: string;
let server: Server;
let baseUrl: string;
let mcpSessionId: string | undefined;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "obsidian-mcp-apps-test-"));
  await fs.mkdir(path.join(tempDir, "Projects"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "Projects", "Cloudflare.md"), "# Cloudflare\n\nManaged OAuth search result.\n", "utf8");

  const config = loadConfig({
    HOST: "127.0.0.1",
    PORT: "8787",
    VAULT_PATH: tempDir,
    VAULT_NAME: "TestVault",
    READ_ONLY: "true",
    MCP_APP_RESOURCE_DOMAIN: "test.claudemcpcontent.com",
    CF_ACCESS_REQUIRED: "false",
    CF_ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-aud"
  });
  const appHandle = createApp(config);
  server = createServer(appHandle.app);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  mcpSessionId = undefined;
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("MCP Apps integration", () => {
  it("advertises MCP Apps support in the initialize result", async () => {
    const { body, sessionId } = await initializeMcp();

    expect(sessionId).toEqual(expect.any(String));
    expect(
      body.result.capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes
    ).toContain("text/html;profile=mcp-app");
  });

  it("advertises the interactive search tool and serves the UI resource", async () => {
    await initialize();

    const tools = await callMcp("tools/list", {});
    const interactiveTool = tools.result.tools.find((tool: { name: string }) => tool.name === "search_notes_interactive");

    expect(interactiveTool?._meta?.ui?.resourceUri).toBe(SEARCH_RESULTS_RESOURCE_URI);
    expect(interactiveTool?._meta?.["ui/resourceUri"]).toBe(SEARCH_RESULTS_RESOURCE_URI);

    const resource = await callMcp("resources/read", { uri: SEARCH_RESULTS_RESOURCE_URI });
    const content = resource.result.contents[0];

    expect(content.uri).toBe(SEARCH_RESULTS_RESOURCE_URI);
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content._meta?.ui?.domain).toBe("test.claudemcpcontent.com");
    expect(content.text).toContain("Obsidian Search Results");
    expect(content.text).toContain("callServerTool");
    expect(content.text).toContain("write_note");
  });

  it("returns structured data for the interactive search UI", async () => {
    await initialize();

    const result = await callMcp("tools/call", {
      name: "search_notes_interactive",
      arguments: { query: "OAuth" }
    });

    expect(result.result.structuredContent.readOnly).toBe(true);
    expect(result.result.structuredContent.results).toHaveLength(1);
    expect(result.result.structuredContent.results[0].path).toBe("Projects/Cloudflare.md");
  });

  it("advertises the interactive note editor tool and serves the UI resource", async () => {
    await initialize();

    const tools = await callMcp("tools/list", {});
    const editorTool = tools.result.tools.find((tool: { name: string }) => tool.name === "edit_note_interactive");

    expect(editorTool?._meta?.ui?.resourceUri).toBe(NOTE_EDITOR_RESOURCE_URI);
    expect(editorTool?._meta?.["ui/resourceUri"]).toBe(NOTE_EDITOR_RESOURCE_URI);

    const resource = await callMcp("resources/read", { uri: NOTE_EDITOR_RESOURCE_URI });
    const content = resource.result.contents[0];

    expect(content.uri).toBe(NOTE_EDITOR_RESOURCE_URI);
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content._meta?.ui?.domain).toBe("test.claudemcpcontent.com");
    expect(content.text).toContain("Obsidian Note Editor");
    expect(content.text).toContain("write_note");
  });

  it("returns structured note data for the interactive note editor UI", async () => {
    await initialize();

    const result = await callMcp("tools/call", {
      name: "edit_note_interactive",
      arguments: { path: "Projects/Cloudflare" }
    });

    expect(result.result.structuredContent.readOnly).toBe(true);
    expect(result.result.structuredContent.path).toBe("Projects/Cloudflare.md");
    expect(result.result.structuredContent.note.content).toContain("Managed OAuth");
  });

  it("treats null and empty optional search fields as omitted", async () => {
    await initialize();

    const result = await callMcp("tools/call", {
      name: "search_notes",
      arguments: { query: "OAuth", folder: "", limit: null }
    });

    expect(result.result.isError).not.toBe(true);
    expect(result.result.content[0].text).toContain("Projects/Cloudflare.md");
  });

  it("keeps a stateless fallback for clients that do not send session IDs", async () => {
    const toolsResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      })
    });

    expect(toolsResponse.status).toBe(200);
    const tools = await parseMcpResponse(toolsResponse);
    expect(tools.result.tools.some((tool: { name: string }) => tool.name === "search_notes")).toBe(true);

    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_notes", arguments: { query: "OAuth" } }
      })
    });

    expect(response.status).toBe(200);
    const result = await parseMcpResponse(response);
    expect(result.result.content[0].text).toContain("Projects/Cloudflare.md");
  });

  it("falls back gracefully when clients send stale MCP session IDs", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": "stale-session"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_notes", arguments: { query: "OAuth" } }
      })
    });

    expect(response.status).toBe(200);
    const result = await parseMcpResponse(response);
    expect(result.result.content[0].text).toContain("Projects/Cloudflare.md");
  });
});

describe("Cloudflare Access OAuth compatibility", () => {
  it("serves authorization metadata from the origin after Access login", async () => {
    const response = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);

    expect(response.status).toBe(200);
    const metadata = (await response.json()) as {
      issuer: string;
      authorization_endpoint: string;
      registration_endpoint: string;
      code_challenge_methods_supported: string[];
    };

    expect(metadata.issuer).toBe("https://example.cloudflareaccess.com");
    expect(metadata.authorization_endpoint).toBe(
      "https://example.cloudflareaccess.com/cdn-cgi/access/oauth/authorization"
    );
    expect(metadata.registration_endpoint).toBe(
      "https://example.cloudflareaccess.com/cdn-cgi/access/oauth/registration"
    );
    expect(metadata.code_challenge_methods_supported).toContain("S256");
  });

  it("redirects /authorize to Cloudflare Managed OAuth and preserves query params", async () => {
    const response = await fetch(
      `${baseUrl}/authorize?client_id=claude&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&response_type=code`,
      { redirect: "manual" }
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();

    const redirect = new URL(location!);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(
      "https://example.cloudflareaccess.com/cdn-cgi/access/oauth/authorization"
    );
    expect(redirect.searchParams.get("client_id")).toBe("claude");
    expect(redirect.searchParams.get("response_type")).toBe("code");
    expect(redirect.searchParams.get("redirect_uri")).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(redirect.searchParams.get("resource")).toBe(`${baseUrl}/mcp`);
  });
});

describe("Security hardening", () => {
  it("rate limits clients past the configured per-minute budget", async () => {
    const { server: limitedServer, baseUrl: limitedBase } = await startServer({
      RATE_LIMIT_PER_MINUTE: "2"
    });

    try {
      const statuses: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const response = await fetch(`${limitedBase}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: i, method: "tools/list", params: {} })
        });
        await response.text();
        statuses.push(response.status);
      }

      expect(statuses[0]).not.toBe(429);
      expect(statuses[2]).toBe(429);
    } finally {
      await closeServer(limitedServer);
    }
  });

  it("rejects requests with a Host outside the allow-list when configured", async () => {
    const { server: guardedServer, baseUrl: guardedBase } = await startServer({
      ALLOWED_HOSTS: "obsidian.example.com"
    });

    try {
      const response = await fetch(`${guardedBase}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          host: "evil.example.com"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      });

      expect(response.status).toBe(403);
    } finally {
      await closeServer(guardedServer);
    }
  });
});

async function startServer(overrides: Record<string, string>) {
  const config = loadConfig({
    HOST: "127.0.0.1",
    PORT: "8787",
    VAULT_PATH: tempDir,
    VAULT_NAME: "TestVault",
    CF_ACCESS_REQUIRED: "false",
    ...overrides
  });
  const { app } = createApp(config);
  const startedServer = createServer(app);
  await new Promise<void>((resolve) => startedServer.listen(0, "127.0.0.1", resolve));
  const address = startedServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  return { server: startedServer, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(target: Server) {
  await new Promise<void>((resolve, reject) => {
    target.close((error) => (error ? reject(error) : resolve()));
  });
}

async function initialize() {
  const { sessionId } = await initializeMcp();
  mcpSessionId = sessionId;
}

async function initializeMcp() {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": {
              mimeTypes: ["text/html;profile=mcp-app"]
            }
          }
        },
        clientInfo: { name: "vitest", version: "0.0.0" }
      }
    })
  });

  expect(response.status).toBe(200);
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toEqual(expect.any(String));
  const body = await parseMcpResponse(response);

  return { body, sessionId: sessionId! };
}

async function callMcp(method: string, params: unknown) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(mcpSessionId ? { "mcp-session-id": mcpSessionId } : {})
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 100000),
      method,
      params
    })
  });

  expect(response.status).toBe(200);
  return parseMcpResponse(response);
}

async function parseMcpResponse(response: Response) {
  const text = await response.text();
  const dataLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data: "));

  if (!dataLine) {
    throw new Error(`No SSE data line in response: ${text}`);
  }

  return JSON.parse(dataLine.slice("data: ".length));
}
