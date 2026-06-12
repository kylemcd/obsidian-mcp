import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Vault, VaultPathError } from "../src/vault.js";

let tempDir: string;
let vault: Vault;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "obsidian-mcp-test-"));
  vault = new Vault(tempDir);
  await fs.mkdir(path.join(tempDir, "Projects"), { recursive: true });
  await fs.mkdir(path.join(tempDir, ".obsidian"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "Inbox.md"), "# Inbox\n\nremember the milk\n", "utf8");
  await fs.writeFile(path.join(tempDir, "Projects", "Cloudflare.md"), "# Cloudflare MCP\n\nManaged OAuth notes.\n", "utf8");
  await fs.writeFile(path.join(tempDir, ".obsidian", "workspace.md"), "# Hidden\n", "utf8");
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("Vault", () => {
  it("lists markdown notes and skips Obsidian metadata folders", async () => {
    const notes = await vault.listNotes();

    expect(notes.map((note) => note.path)).toEqual(["Inbox.md", "Projects/Cloudflare.md"]);
    expect(notes[0]?.title).toBe("Inbox");
  });

  it("reads notes with optional markdown extension", async () => {
    const note = await vault.readNote("Projects/Cloudflare");

    expect(note.path).toBe("Projects/Cloudflare.md");
    expect(note.title).toBe("Cloudflare MCP");
    expect(note.content).toContain("Managed OAuth");
  });

  it("rejects traversal outside the vault", () => {
    expect(() => vault.resolveNotePath("../secrets")).toThrow(VaultPathError);
    expect(() => vault.resolveNotePath("/etc/passwd")).toThrow(VaultPathError);
  });

  it("searches notes with snippets", async () => {
    const matches = await vault.searchNotes({ query: "oauth" });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe("Projects/Cloudflare.md");
    expect(matches[0]?.snippet.toLowerCase()).toContain("oauth");
  });

  it("creates notes without overwriting by default", async () => {
    await vault.writeNote({ path: "New Note", content: "# New Note\n" });

    await expect(vault.writeNote({ path: "New Note", content: "again" })).rejects.toThrow("already exists");
    expect((await vault.readNote("New Note")).content).toContain("# New Note");
  });

  it("appends to notes", async () => {
    await vault.appendNote({ path: "Inbox", content: "- second item" });

    const note = await vault.readNote("Inbox");
    expect(note.content).toContain("remember the milk");
    expect(note.content).toContain("- second item");
  });
});

