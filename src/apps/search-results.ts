import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  loadExtAppsBundle,
  obsidianUiMeta,
  type ObsidianAppResourceOptions,
  type ObsidianUiMeta
} from "./shared.js";

export const SEARCH_RESULTS_RESOURCE_URI = "ui://obsidian/search";

export function registerSearchResultsAppResource(server: McpServer, options: ObsidianAppResourceOptions = {}) {
  const uiMeta = obsidianUiMeta(options);

  registerAppResource(
    server,
    "Obsidian Search Results",
    SEARCH_RESULTS_RESOURCE_URI,
    {
      description: "Interactive Obsidian search result explorer and Markdown editor.",
      _meta: {
        ui: uiMeta
      }
    },
    async () => {
      const html = await renderSearchResultsAppHtml();
      logAppResourceRead(SEARCH_RESULTS_RESOURCE_URI, html, uiMeta);

      return {
        contents: [
          {
            uri: SEARCH_RESULTS_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: uiMeta
            }
          }
        ]
      };
    }
  );
}

function logAppResourceRead(uri: string, html: string, uiMeta: ObsidianUiMeta) {
  console.log(
    "mcp_app_resource_read",
    JSON.stringify({
      uri,
      mimeType: RESOURCE_MIME_TYPE,
      bytes: Buffer.byteLength(html, "utf8"),
      domain: uiMeta.domain
    })
  );
}

async function renderSearchResultsAppHtml() {
  const appBundle = await loadExtAppsBundle();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Obsidian Search Results</title>
    <style>
      :root {
        color-scheme: light dark;
        --app-bg: var(--color-background-primary, Canvas);
        --panel-bg: var(--color-background-secondary, color-mix(in srgb, Canvas 94%, CanvasText 6%));
        --panel-hover: var(--color-background-tertiary, color-mix(in srgb, Canvas 88%, CanvasText 12%));
        --selected-bg: var(--color-background-info, color-mix(in srgb, Highlight 16%, transparent));
        --border: var(--color-border-secondary, color-mix(in srgb, CanvasText 18%, transparent));
        --border-muted: var(--color-border-tertiary, color-mix(in srgb, CanvasText 10%, transparent));
        --text: var(--color-text-primary, CanvasText);
        --muted: var(--color-text-secondary, color-mix(in srgb, CanvasText 64%, transparent));
        --danger: var(--color-text-danger, #b00020);
        --focus: var(--color-ring-primary, Highlight);
        --success: var(--color-text-success, #126a3a);
        --radius: min(var(--border-radius-md, 8px), 8px);
        font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        background: var(--app-bg);
        color: var(--text);
      }
      * {
        box-sizing: border-box;
        min-width: 0;
      }
      html, body {
        margin: 0;
        min-height: 100%;
        background: var(--app-bg);
        color: var(--text);
      }
      body {
        font-size: 14px;
      }
      button, input, textarea {
        font: inherit;
      }
      button {
        appearance: none;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--panel-bg);
        color: var(--text);
        cursor: pointer;
        min-height: 34px;
        padding: 0 11px;
      }
      button:hover { background: var(--panel-hover); }
      button:focus-visible, input:focus-visible, textarea:focus-visible {
        outline: 2px solid var(--focus);
        outline-offset: 1px;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .shell {
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        gap: 10px;
        height: clamp(620px, 78vh, 760px);
        min-height: 620px;
        padding: 10px;
        background: var(--app-bg);
      }
      .search-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
      }
      input {
        width: 100%;
        min-height: 38px;
        border: 1px solid var(--border);
        border-radius: 7px;
        background: var(--app-bg);
        color: var(--text);
        padding: 8px 10px;
      }
      .summary {
        color: var(--muted);
        font-size: var(--font-text-sm-size, 13px);
        line-height: 1.3;
        min-height: 18px;
      }
      .layout {
        display: grid;
        grid-template-columns: minmax(230px, 0.78fr) minmax(420px, 1.22fr);
        gap: 10px;
        min-height: 0;
      }
      .panel {
        min-height: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--panel-bg);
        overflow: hidden;
      }
      .list {
        display: grid;
        align-content: start;
        height: 100%;
        overflow: auto;
      }
      .result {
        display: grid;
        grid-template-rows: 17px 15px 34px;
        gap: 2px;
        width: 100%;
        height: 84px;
        min-height: 84px;
        max-height: 84px;
        padding: 7px 10px;
        border: 0;
        border-bottom: 1px solid var(--border-muted);
        border-radius: 0;
        background: transparent;
        color: var(--text);
        text-align: left;
        overflow: hidden;
        align-items: start;
      }
      .result:hover { background: var(--panel-hover); }
      .result[aria-current="true"] {
        background: var(--selected-bg);
      }
      .path {
        color: var(--muted);
        font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
        font-size: 11.5px;
        line-height: 15px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .title {
        display: block;
        font-weight: var(--font-weight-semibold, 650);
        font-size: 13.5px;
        line-height: 17px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .snippet {
        display: -webkit-box;
        color: var(--muted);
        font-size: 12.5px;
        line-height: 17px;
        max-height: 34px;
        overflow: hidden;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .preview {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: 100%;
      }
      .preview-header {
        display: grid;
        gap: 4px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border-muted);
      }
      .editor-wrap {
        display: grid;
        grid-template-rows: minmax(0, 1fr) 0;
        min-height: 0;
        background: var(--app-bg);
      }
      .editor-wrap.dirty {
        grid-template-rows: minmax(0, 1fr) 58px;
      }
      .markdown-editor {
        display: block;
        width: 100%;
        height: 100%;
        min-height: 0;
        resize: none;
        border: 0;
        border-radius: 0;
        background: var(--app-bg);
        color: var(--text);
        padding: 14px 16px;
        font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .markdown-editor[readonly] {
        color: var(--muted);
      }
      .save-bar {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        gap: 8px;
        align-items: center;
        min-height: 0;
        height: 0;
        overflow: hidden;
        padding: 0 12px;
        border-top: 0 solid transparent;
        background: var(--panel-bg);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 140ms ease, transform 140ms ease, height 140ms ease, padding 140ms ease;
      }
      .save-bar.visible {
        height: 58px;
        padding: 10px 12px;
        border-top: 1px solid var(--border-muted);
        opacity: 1;
        transform: translateY(0);
      }
      .save-status {
        color: var(--muted);
        font-size: var(--font-text-sm-size, 13px);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .primary {
        background: var(--text);
        border-color: var(--text);
        color: var(--app-bg);
      }
      .primary:hover {
        background: color-mix(in srgb, var(--text) 86%, var(--app-bg));
      }
      .empty {
        padding: 16px;
        color: var(--muted);
        line-height: 1.35;
      }
      .error { color: var(--danger); }
      .success { color: var(--success); }
      @media (max-width: 640px) {
        .shell {
          height: 820px;
          min-height: 820px;
        }
        .search-row {
          grid-template-columns: 1fr;
        }
        .layout {
          grid-template-columns: 1fr;
          grid-template-rows: 250px 1fr;
        }
        .list {
          height: 250px;
        }
        .save-bar {
          grid-template-columns: 1fr;
          height: 0;
        }
        .editor-wrap.dirty {
          grid-template-rows: minmax(0, 1fr) 136px;
        }
        .save-bar.visible {
          height: 136px;
        }
        .save-status {
          white-space: normal;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <form class="search-row" id="search-form">
        <input id="query" name="query" autocomplete="off" placeholder="Search notes" />
        <button id="search-button" type="submit">Search</button>
      </form>
      <div class="summary" id="summary">Connecting to host...</div>
      <section class="layout">
        <div class="panel list" id="results"></div>
        <div class="panel preview" id="preview">
          <div class="empty">Select a note to edit it.</div>
        </div>
      </section>
    </main>
    <script type="module">
${appBundle}
const App = __MCP_APPS_App;
${searchResultsClientScript}
    </script>
  </body>
</html>`;
}

const searchResultsClientScript = String.raw`
const app = new App({ name: "Obsidian Search Results", version: "0.2.0" });

const state = {
  query: "",
  results: [],
  readOnly: true,
  selectedPath: "",
  selectedNote: null,
  originalContent: "",
  editorContent: "",
  pendingPath: "",
  isDirty: false,
  isSaving: false,
  status: "Connecting to host..."
};

const summaryEl = document.getElementById("summary");
const resultsEl = document.getElementById("results");
const previewEl = document.getElementById("preview");
const queryEl = document.getElementById("query");
const searchForm = document.getElementById("search-form");
const searchButton = document.getElementById("search-button");

app.ontoolinput = (params) => {
  if (params?.arguments?.query && !state.query) {
    state.query = String(params.arguments.query);
    queryEl.value = state.query;
  }
};

app.ontoolresult = (result) => {
  try {
    const payload = payloadFromToolResult(result);
    if (payload && Array.isArray(payload.results)) {
      setSearchPayload(payload);
    } else if (Array.isArray(payload)) {
      setSearchPayload({ query: state.query, results: payload, readOnly: state.readOnly });
    } else {
      state.status = "Interactive search returned data in an unexpected format.";
      render();
    }
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Interactive search failed.";
    render();
  }
};

app.onhostcontextchanged = applyHostContext;
app.onteardown = async () => ({});

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = queryEl.value.trim();
  if (!query) return;

  state.query = query;
  state.status = "Searching...";
  state.results = [];
  clearSelectedNote();
  render();

  searchButton.disabled = true;
  try {
    const result = await app.callServerTool({
      name: "search_notes",
      arguments: { query, limit: 50 }
    });
    const payload = payloadFromToolResult(result);
    if (payload && Array.isArray(payload.results)) {
      setSearchPayload(payload);
    } else {
      const results = Array.isArray(payload) ? payload : [];
      setSearchPayload({ query, results, readOnly: state.readOnly });
    }
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Search failed.";
    render();
  } finally {
    searchButton.disabled = false;
  }
});

resultsEl.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("[data-note-path]");
  if (!button) return;
  await handleSelectNote(button.dataset.notePath);
});

previewEl.addEventListener("input", (event) => {
  const target = event.target instanceof HTMLTextAreaElement ? event.target : null;
  if (target?.id !== "note-editor") return;
  state.editorContent = target.value;
  state.isDirty = state.editorContent !== state.originalContent;
  state.pendingPath = "";
  renderSummary();
  renderSaveBar();
});

previewEl.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("[data-action]");
  if (!button) return;

  if (button.dataset.action === "save-note") {
    await saveSelectedNote();
  }
  if (button.dataset.action === "discard-changes") {
    await discardChanges();
  }
});

render();
await app.connect();

function applyHostContext(context) {
  if (context.theme === "dark" || context.theme === "light") {
    document.documentElement.dataset.theme = context.theme;
    document.documentElement.style.colorScheme = context.theme;
  }
  if (context.styles?.variables) {
    for (const [key, value] of Object.entries(context.styles.variables)) {
      if (value != null) document.documentElement.style.setProperty(key, value);
    }
  }
  if (context.styles?.css?.fonts && !document.getElementById("host-fonts")) {
    const style = document.createElement("style");
    style.id = "host-fonts";
    style.textContent = context.styles.css.fonts;
    document.head.appendChild(style);
  }
}

function setSearchPayload(payload) {
  state.query = payload.query ?? state.query;
  state.results = Array.isArray(payload.results) ? payload.results : [];
  state.readOnly = Boolean(payload.readOnly);
  state.status = state.results.length === 1
    ? "1 note found."
    : state.results.length + " notes found.";
  queryEl.value = state.query;
  render();
}

async function handleSelectNote(path) {
  if (!path || path === state.selectedPath) return;

  if (state.isDirty) {
    state.pendingPath = path;
    state.status = "Save or discard changes before switching notes.";
    renderSummary();
    renderSaveBar();
    return;
  }

  await readNote(path);
}

async function readNote(path) {
  state.selectedPath = path;
  state.selectedNote = null;
  state.originalContent = "";
  state.editorContent = "";
  state.isDirty = false;
  state.pendingPath = "";
  state.status = "Reading " + path + "...";
  render();

  try {
    const result = await app.callServerTool({
      name: "read_note",
      arguments: { path }
    });
    setSelectedNote(payloadFromToolResult(result));
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Read failed.";
    render();
  }
}

function setSelectedNote(note) {
  state.selectedNote = note;
  state.selectedPath = note.path || state.selectedPath;
  state.originalContent = String(note.content ?? "");
  state.editorContent = state.originalContent;
  state.isDirty = false;
  state.pendingPath = "";
  state.status = "Editing " + state.selectedPath + ".";
  render();
}

async function saveSelectedNote() {
  const editor = document.getElementById("note-editor");
  if (!state.selectedPath || !(editor instanceof HTMLTextAreaElement) || state.readOnly) return;

  state.editorContent = editor.value;
  state.isSaving = true;
  state.status = "Saving " + state.selectedPath + "...";
  renderSummary();
  renderSaveBar();

  try {
    const result = await app.callServerTool({
      name: "write_note",
      arguments: {
        path: state.selectedPath,
        content: state.editorContent,
        overwrite: true
      }
    });
    payloadFromToolResult(result);
    state.originalContent = state.editorContent;
    state.isDirty = false;
    state.pendingPath = "";
    state.isSaving = false;
    await readNote(state.selectedPath);
    state.status = "Saved " + state.selectedPath + ".";
    renderSummary();
    renderSaveBar();
  } catch (error) {
    state.isSaving = false;
    state.status = error instanceof Error ? error.message : "Save failed.";
    renderSummary();
    renderSaveBar();
  }
}

async function discardChanges() {
  const nextPath = state.pendingPath;
  const editor = document.getElementById("note-editor");
  state.editorContent = state.originalContent;
  state.isDirty = false;
  state.pendingPath = "";

  if (editor instanceof HTMLTextAreaElement) {
    editor.value = state.originalContent;
  }

  if (nextPath) {
    await readNote(nextPath);
    return;
  }

  state.status = state.selectedPath ? "Editing " + state.selectedPath + "." : state.status;
  renderSummary();
  renderSaveBar();
}

function clearSelectedNote() {
  state.selectedPath = "";
  state.selectedNote = null;
  state.originalContent = "";
  state.editorContent = "";
  state.pendingPath = "";
  state.isDirty = false;
  state.isSaving = false;
}

function render() {
  renderSummary();
  renderResults();
  renderPreview();
}

function renderSummary() {
  summaryEl.textContent = state.query
    ? '"' + state.query + '" - ' + state.status
    : state.status;
  summaryEl.classList.toggle("error", /failed|unexpected|error|discard/i.test(state.status));
  summaryEl.classList.toggle("success", /^Saved /.test(state.status));
}

function renderResults() {
  if (state.results.length === 0) {
    resultsEl.innerHTML = '<div class="empty">No results yet.</div>';
    return;
  }

  resultsEl.innerHTML = state.results.map((result) => {
    const selected = result.path === state.selectedPath ? ' aria-current="true"' : "";
    return '<button class="result" type="button" data-note-path="' + escapeAttribute(result.path) + '"' + selected + '>'
      + '<span class="title">' + escapeHtml(compactText(result.title || result.path, 90)) + '</span>'
      + '<span class="path">' + escapeHtml(result.path) + '</span>'
      + '<span class="snippet">' + escapeHtml(compactText(result.snippet || "", 180)) + '</span>'
      + '</button>';
  }).join("");
}

function renderPreview() {
  if (!state.selectedPath) {
    previewEl.innerHTML = '<div class="empty">Select a note to edit it.</div>';
    return;
  }

  if (!state.selectedNote) {
    previewEl.innerHTML = '<div class="empty">Loading note...</div>';
    return;
  }

  const note = state.selectedNote;
  const readonlyAttr = state.readOnly ? " readonly" : "";
  const dirtyClass = state.isDirty ? " dirty" : "";

  previewEl.innerHTML = '<div class="preview-header">'
    + '<div class="title">' + escapeHtml(note.title || note.path) + '</div>'
    + '<div class="path">' + escapeHtml(note.path) + '</div>'
    + '</div>'
    + '<div class="editor-wrap' + dirtyClass + '" id="editor-wrap">'
    + '<textarea id="note-editor" class="markdown-editor" spellcheck="true"' + readonlyAttr + '>'
    + escapeHtml(state.editorContent)
    + '</textarea>'
    + '<div class="save-bar" id="save-bar" aria-hidden="true"></div>'
    + '</div>';

  renderSaveBar();
}

function renderSaveBar() {
  const saveBar = document.getElementById("save-bar");
  const editorWrap = document.getElementById("editor-wrap");
  if (!saveBar || !editorWrap) return;

  const visible = (state.isDirty || state.isSaving || Boolean(state.pendingPath)) && !state.readOnly;
  editorWrap.classList.toggle("dirty", visible);
  saveBar.classList.toggle("visible", visible);
  saveBar.setAttribute("aria-hidden", visible ? "false" : "true");

  const status = state.isSaving
    ? "Saving..."
    : state.pendingPath
      ? "Unsaved changes"
      : "Unsaved changes";

  saveBar.innerHTML = '<span class="save-status">' + escapeHtml(status) + '</span>'
    + '<button type="button" data-action="discard-changes"' + (state.isSaving ? " disabled" : "") + '>Discard</button>'
    + '<button class="primary" type="button" data-action="save-note"' + (state.isSaving ? " disabled" : "") + '>Save</button>';
}

function payloadFromToolResult(result) {
  if (result?.isError) {
    const text = result.content?.find((item) => item.type === "text")?.text;
    throw new Error(text || "Tool returned an error.");
  }

  if (result?.structuredContent && Object.keys(result.structuredContent).length > 0) {
    return result.structuredContent;
  }

  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function compactText(value, maxLength) {
  const compacted = String(value ?? "").replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  return compacted.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}
`;
