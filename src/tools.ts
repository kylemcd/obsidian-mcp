import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";

import { cloudflareAccessIdentityText, type CloudflareAccessIdentity } from "./cloudflare-access.js";
import { NOTE_EDITOR_RESOURCE_URI } from "./apps/note-editor.js";
import { SEARCH_RESULTS_RESOURCE_URI } from "./apps/search-results.js";
import type { Vault } from "./vault.js";

export type RegisterToolOptions = {
  readOnly: boolean;
  vaultName: string;
  identity?: CloudflareAccessIdentity;
};

const optionalFolderSchema = z
  .string()
  .nullable()
  .optional()
  .describe("Optional vault-relative folder to search or list. Leave empty to search the whole vault.");

const optionalLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(500)
  .nullable()
  .optional()
  .describe("Maximum number of notes or matches to return.");

export function registerVaultTools(server: McpServer, vault: Vault, options: RegisterToolOptions) {
  server.registerTool(
    "vault_status",
    {
      title: "Vault Status",
      description: "Report vault metadata and the current Cloudflare Access identity boundary.",
      inputSchema: {}
    },
    async () =>
      jsonResult({
        vaultName: options.vaultName,
        vaultPath: vault.root,
        readOnly: options.readOnly,
        identity: cloudflareAccessIdentityText(options.identity)
      })
  );

  server.registerTool(
    "list_notes",
    {
      title: "List Notes",
      description: "List Markdown notes in the Obsidian vault.",
      inputSchema: {
        folder: optionalFolderSchema,
        limit: optionalLimitSchema
      }
    },
    async ({ folder, limit }) =>
      runTool("list_notes", { hasFolder: hasText(folder), hasLimit: limit != null }, async () =>
        jsonResult(await vault.listNotes({ folder: normalizeOptionalText(folder), limit: normalizeOptionalLimit(limit) }))
      )
  );

  server.registerTool(
    "read_note",
    {
      title: "Read Note",
      description: "Read one Markdown note by vault-relative path.",
      inputSchema: {
        path: z.string().min(1).describe("Vault-relative note path. The .md extension is optional.")
      }
    },
    async ({ path }) =>
      runTool("read_note", { pathLength: path.length }, async () => jsonResult(await vault.readNote(path)))
  );

  server.registerTool(
    "search_notes",
    {
      title: "Search Notes",
      description: "Search Markdown notes with a case-insensitive plain-text query.",
      inputSchema: {
        query: z.string().min(1).describe("Plain-text search query."),
        folder: optionalFolderSchema,
        limit: optionalLimitSchema
      }
    },
    async ({ query, folder, limit }) =>
      runTool(
        "search_notes",
        { queryLength: query.length, hasFolder: hasText(folder), hasLimit: limit != null },
        async () =>
          jsonResult(
            await vault.searchNotes({
              query,
              folder: normalizeOptionalText(folder),
              limit: normalizeOptionalLimit(limit)
            })
          )
      )
  );

  registerAppTool(
    server,
    "search_notes_interactive",
    {
      title: "Search Notes Interactive",
      description: "Search the Obsidian vault and render interactive results for MCP Apps-capable clients.",
      inputSchema: {
        query: z.string().min(1).describe("Plain-text search query."),
        folder: optionalFolderSchema,
        limit: optionalLimitSchema
      },
      _meta: {
        ui: {
          resourceUri: SEARCH_RESULTS_RESOURCE_URI
        }
      }
    },
    async ({ query, folder, limit }) =>
      runTool(
        "search_notes_interactive",
        { queryLength: query.length, hasFolder: hasText(folder), hasLimit: limit != null },
        async () => searchNotesAppResult(vault, options.readOnly, query, folder, limit)
      )
  );

  registerAppTool(
    server,
    "edit_note_interactive",
    {
      title: "Edit Note Interactive",
      description: "Open one Obsidian Markdown note in an inline editor for MCP Apps-capable clients.",
      inputSchema: {
        path: z.string().min(1).describe("Vault-relative note path. The .md extension is optional.")
      },
      _meta: {
        ui: {
          resourceUri: NOTE_EDITOR_RESOURCE_URI
        }
      }
    },
    async ({ path }) =>
      runTool("edit_note_interactive", { pathLength: path.length }, async () =>
        noteEditorAppResult(vault, options.readOnly, path)
      )
  );

  server.registerTool(
    "write_note",
    {
      title: "Write Note",
      description: "Create or overwrite a Markdown note. Disabled when READ_ONLY=true.",
      inputSchema: {
        path: z.string().min(1).describe("Vault-relative note path. The .md extension is optional."),
        content: z.string().describe("Full Markdown content to write."),
        overwrite: z.boolean().optional().describe("Allow replacing an existing note.")
      }
    },
    async ({ path, content, overwrite }) => {
      return runTool("write_note", { pathLength: path.length, contentLength: content.length }, async () => {
        assertWritable(options.readOnly);
        return jsonResult(await vault.writeNote({ path, content, overwrite }));
      });
    }
  );

  server.registerTool(
    "append_note",
    {
      title: "Append Note",
      description: "Append Markdown content to a note. Disabled when READ_ONLY=true.",
      inputSchema: {
        path: z.string().min(1).describe("Vault-relative note path. The .md extension is optional."),
        content: z.string().describe("Markdown content to append."),
        create: z.boolean().optional().describe("Create the note if it does not exist. Defaults to true.")
      }
    },
    async ({ path, content, create }) => {
      return runTool("append_note", { pathLength: path.length, contentLength: content.length }, async () => {
        assertWritable(options.readOnly);
        return jsonResult(await vault.appendNote({ path, content, create }));
      });
    }
  );
}

function assertWritable(readOnly: boolean) {
  if (readOnly) {
    throw new Error("This server is running with READ_ONLY=true.");
  }
}

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

async function noteEditorAppResult(vault: Vault, readOnly: boolean, path: string) {
  const note = await vault.readNote(path);
  const payload = {
    path: note.path,
    readOnly,
    note
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

async function searchNotesAppResult(
  vault: Vault,
  readOnly: boolean,
  query: string,
  folder: string | null | undefined,
  limit: number | null | undefined
) {
  const normalizedFolder = normalizeOptionalText(folder);
  const normalizedLimit = normalizeOptionalLimit(limit);
  const payload = {
    query,
    folder: normalizedFolder,
    limit: normalizedLimit ?? 25,
    readOnly,
    results: await vault.searchNotes({ query, folder: normalizedFolder, limit: normalizedLimit })
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

function hasText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeOptionalText(value: string | null | undefined) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOptionalLimit(value: number | null | undefined) {
  return value ?? undefined;
}

async function runTool<T>(tool: string, details: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  console.log("mcp_tool_call", JSON.stringify({ tool, ...details }));
  try {
    const result = await fn();
    console.log("mcp_tool_result", JSON.stringify({ tool, status: "ok", ms: Date.now() - started }));
    return result;
  } catch (error) {
    console.warn(
      "mcp_tool_result",
      JSON.stringify({
        tool,
        status: "error",
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error)
      })
    );
    throw error;
  }
}
