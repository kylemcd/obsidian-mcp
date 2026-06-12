import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EXTENSION_ID, getUiCapability, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import type { CloudflareAccessIdentity } from "./cloudflare-access.js";
import type { AppConfig } from "./config.js";
import { registerNoteEditorAppResource } from "./apps/note-editor.js";
import { registerSearchResultsAppResource } from "./apps/search-results.js";
import { registerVaultTools } from "./tools.js";
import { Vault } from "./vault.js";

export function createObsidianMcpServer(config: AppConfig, identity?: CloudflareAccessIdentity) {
  const vault = new Vault(config.vaultPath);
  const server = new McpServer(
    {
      name: "obsidian-mcp",
      version: "0.1.0"
    },
    {
      capabilities: {
        extensions: {
          [EXTENSION_ID]: {
            mimeTypes: [RESOURCE_MIME_TYPE]
          }
        }
      }
    }
  );

  server.server.oninitialized = () => {
    const clientCapabilities = server.server.getClientCapabilities();
    const clientVersion = server.server.getClientVersion();
    const uiCapability = getUiCapability(clientCapabilities);
    const mimeTypes = Array.isArray(uiCapability?.mimeTypes)
      ? uiCapability.mimeTypes.filter((mimeType: unknown): mimeType is string => typeof mimeType === "string")
      : [];

    console.log(
      "mcp_client_initialized",
      JSON.stringify({
        clientName: clientVersion?.name,
        clientVersion: clientVersion?.version,
        mcpAppsSupported: mimeTypes.includes(RESOURCE_MIME_TYPE),
        mcpAppsMimeTypes: mimeTypes
      })
    );
  };

  registerSearchResultsAppResource(server, {
    domain: config.mcpAppResourceDomain
  });
  registerNoteEditorAppResource(server, {
    domain: config.mcpAppResourceDomain
  });

  registerVaultTools(server, vault, {
    vaultName: config.vaultName,
    readOnly: config.readOnly,
    identity
  });

  return server;
}
