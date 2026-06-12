import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  loadExtAppsBundle,
  obsidianUiMeta,
  type ObsidianAppResourceOptions,
  type ObsidianUiMeta
} from "./shared.js";

export const NOTE_EDITOR_RESOURCE_URI = "ui://obsidian/note-editor";

export function registerNoteEditorAppResource(server: McpServer, options: ObsidianAppResourceOptions = {}) {
  const uiMeta = obsidianUiMeta(options);

  registerAppResource(
    server,
    "Obsidian Note Editor",
    NOTE_EDITOR_RESOURCE_URI,
    {
      description: "Interactive Obsidian Markdown note editor.",
      _meta: {
        ui: uiMeta
      }
    },
    async () => {
      const html = await renderNoteEditorAppHtml();
      logAppResourceRead(NOTE_EDITOR_RESOURCE_URI, html, uiMeta);

      return {
        contents: [
          {
            uri: NOTE_EDITOR_RESOURCE_URI,
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

async function renderNoteEditorAppHtml() {
  const appBundle = await loadExtAppsBundle();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Obsidian Note Editor</title>
    <style>
      :root {
        color-scheme: light dark;
        --app-bg: var(--color-background-primary, Canvas);
        --panel-bg: var(--color-background-secondary, color-mix(in srgb, Canvas 94%, CanvasText 6%));
        --panel-hover: var(--color-background-tertiary, color-mix(in srgb, Canvas 88%, CanvasText 12%));
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
        height: clamp(620px, 78vh, 800px);
        min-height: 620px;
        padding: 10px;
        background: var(--app-bg);
      }
      .path-row {
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
      .panel {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        min-height: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--panel-bg);
        overflow: hidden;
      }
      .note-header {
        display: grid;
        gap: 4px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border-muted);
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
      .path {
        color: var(--muted);
        font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
        font-size: 11.5px;
        line-height: 15px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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
          height: 780px;
          min-height: 780px;
        }
        .path-row {
          grid-template-columns: 1fr;
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
      <form class="path-row" id="path-form">
        <input id="note-path" name="path" autocomplete="off" placeholder="Note path" />
        <button id="open-button" type="submit">Open</button>
      </form>
      <div class="summary" id="summary">Connecting to host...</div>
      <section class="panel" id="editor-panel">
        <div class="empty">Open a note to edit it.</div>
      </section>
    </main>
    <script type="module">
${appBundle}
const App = __MCP_APPS_App;
${noteEditorClientScript}
    </script>
  </body>
</html>`;
}

const noteEditorClientScript = String.raw`
const app = new App({ name: "Obsidian Note Editor", version: "0.1.0" });

const state = {
  path: "",
  readOnly: true,
  note: null,
  originalContent: "",
  editorContent: "",
  isDirty: false,
  isSaving: false,
  status: "Connecting to host..."
};

const summaryEl = document.getElementById("summary");
const panelEl = document.getElementById("editor-panel");
const pathForm = document.getElementById("path-form");
const pathEl = document.getElementById("note-path");
const openButton = document.getElementById("open-button");

app.ontoolinput = (params) => {
  if (params?.arguments?.path && !state.path) {
    state.path = String(params.arguments.path);
    pathEl.value = state.path;
  }
};

app.ontoolresult = (result) => {
  try {
    const payload = payloadFromToolResult(result);
    setPayload(payload);
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Note editor failed.";
    render();
  }
};

app.onhostcontextchanged = applyHostContext;
app.onteardown = async () => ({});

pathForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const path = pathEl.value.trim();
  if (!path) return;

  if (state.isDirty) {
    state.status = "Save or discard changes before opening another note.";
    renderSummary();
    renderSaveBar();
    return;
  }

  await openNote(path);
});

panelEl.addEventListener("input", (event) => {
  const target = event.target instanceof HTMLTextAreaElement ? event.target : null;
  if (target?.id !== "note-editor") return;
  state.editorContent = target.value;
  state.isDirty = state.editorContent !== state.originalContent;
  renderSummary();
  renderSaveBar();
});

panelEl.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("[data-action]");
  if (!button) return;

  if (button.dataset.action === "save-note") {
    await saveNote();
  }
  if (button.dataset.action === "discard-changes") {
    discardChanges();
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

function setPayload(payload) {
  if (!payload) {
    state.status = "Note editor returned no data.";
    render();
    return;
  }

  state.readOnly = Boolean(payload.readOnly);
  const note = payload.note ?? payload;
  if (!note || typeof note !== "object" || typeof note.path !== "string") {
    state.status = "Note editor returned data in an unexpected format.";
    render();
    return;
  }

  setNote(note);
}

async function openNote(path) {
  state.path = path;
  state.note = null;
  state.originalContent = "";
  state.editorContent = "";
  state.isDirty = false;
  state.isSaving = false;
  state.status = "Opening " + path + "...";
  render();

  openButton.disabled = true;
  try {
    const result = await app.callServerTool({
      name: "read_note",
      arguments: { path }
    });
    setNote(payloadFromToolResult(result));
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Open failed.";
    render();
  } finally {
    openButton.disabled = false;
  }
}

function setNote(note) {
  state.note = note;
  state.path = note.path || state.path;
  state.originalContent = String(note.content ?? "");
  state.editorContent = state.originalContent;
  state.isDirty = false;
  state.isSaving = false;
  state.status = "Editing " + state.path + ".";
  pathEl.value = state.path;
  render();
}

async function saveNote() {
  const editor = document.getElementById("note-editor");
  if (!state.path || !(editor instanceof HTMLTextAreaElement) || state.readOnly) return;

  state.editorContent = editor.value;
  state.isSaving = true;
  state.status = "Saving " + state.path + "...";
  renderSummary();
  renderSaveBar();

  try {
    const result = await app.callServerTool({
      name: "write_note",
      arguments: {
        path: state.path,
        content: state.editorContent,
        overwrite: true
      }
    });
    payloadFromToolResult(result);
    state.originalContent = state.editorContent;
    state.isDirty = false;
    state.isSaving = false;
    await openNote(state.path);
    state.status = "Saved " + state.path + ".";
    renderSummary();
    renderSaveBar();
  } catch (error) {
    state.isSaving = false;
    state.status = error instanceof Error ? error.message : "Save failed.";
    renderSummary();
    renderSaveBar();
  }
}

function discardChanges() {
  const editor = document.getElementById("note-editor");
  state.editorContent = state.originalContent;
  state.isDirty = false;
  if (editor instanceof HTMLTextAreaElement) {
    editor.value = state.originalContent;
  }
  state.status = state.path ? "Editing " + state.path + "." : state.status;
  renderSummary();
  renderSaveBar();
}

function render() {
  renderSummary();
  renderEditor();
}

function renderSummary() {
  summaryEl.textContent = state.status;
  summaryEl.classList.toggle("error", /failed|unexpected|error|discard/i.test(state.status));
  summaryEl.classList.toggle("success", /^Saved /.test(state.status));
}

function renderEditor() {
  if (!state.note) {
    panelEl.innerHTML = '<div class="empty">Open a note to edit it.</div>';
    return;
  }

  const readonlyAttr = state.readOnly ? " readonly" : "";
  const dirtyClass = state.isDirty ? " dirty" : "";

  panelEl.innerHTML = '<div class="note-header">'
    + '<div class="title">' + escapeHtml(state.note.title || state.note.path) + '</div>'
    + '<div class="path">' + escapeHtml(state.note.path) + '</div>'
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

  const visible = (state.isDirty || state.isSaving) && !state.readOnly;
  editorWrap.classList.toggle("dirty", visible);
  saveBar.classList.toggle("visible", visible);
  saveBar.setAttribute("aria-hidden", visible ? "false" : "true");

  saveBar.innerHTML = '<span class="save-status">' + escapeHtml(state.isSaving ? "Saving..." : "Unsaved changes") + '</span>'
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
`;
