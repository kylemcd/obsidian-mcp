import { createServer } from "node:http";

import { loadConfig } from "./config.js";
import { createApp } from "./http.js";
import { ManagedSync } from "./managed-sync.js";

const config = loadConfig();
const managedSync = new ManagedSync(config.sync, config.vaultPath);
managedSync.start();

const { app, sessions, sseSessions } = createApp(config, { managedSync });
const server = createServer(app);

server.listen(config.port, config.host, () => {
  console.log(`obsidian-mcp listening on http://${config.host}:${config.port}${config.mcpPath}`);
  console.log(
    `vault=${config.vaultPath} readOnly=${config.readOnly} syncEnabled=${config.sync.enabled} ` +
      `cloudflareAccessRequired=${config.cloudflareAccess.required}`
  );
});

async function shutdown(signal: string) {
  console.log(`received ${signal}, closing ${sessions.size} MCP session(s) and ${sseSessions.size} SSE session(s)`);
  for (const [sessionId, session] of sessions) {
    try {
      await session.transport.close();
    } catch (error) {
      console.error(`failed to close MCP session ${sessionId}:`, error);
    }
  }
  for (const [sessionId, session] of sseSessions) {
    try {
      await session.transport.close();
    } catch (error) {
      console.error(`failed to close SSE MCP session ${sessionId}:`, error);
    }
  }
  try {
    await managedSync.stop();
  } catch (error) {
    console.error("failed to stop managed sync:", error);
  }

  server.close((error) => {
    if (error) {
      console.error("HTTP server close failed:", error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
