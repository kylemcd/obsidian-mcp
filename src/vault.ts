import fs from "node:fs/promises";
import path from "node:path";

const ignoredDirectoryNames = new Set([
  ".git",
  ".obsidian",
  ".trash",
  ".stversions",
  "node_modules"
]);

export type NoteSummary = {
  path: string;
  title: string;
  size: number;
  modifiedAt: string;
};

export type Note = NoteSummary & {
  content: string;
};

export type SearchMatch = NoteSummary & {
  snippet: string;
};

export class VaultPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultPathError";
  }
}

export class Vault {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async assertReady() {
    const stat = await fs.stat(this.root);
    if (!stat.isDirectory()) {
      throw new Error(`Vault path is not a directory: ${this.root}`);
    }
  }

  resolveNotePath(input: string): string {
    const relative = normalizeNotePath(input);
    const absolute = path.resolve(this.root, ...relative.split("/"));

    assertWithinRoot(this.root, absolute);

    return absolute;
  }

  /**
   * Resolve symlinks on the deepest existing ancestor of `absolute` and re-check
   * containment. The string-based check in {@link resolveNotePath} cannot see through
   * symlinks, so a link inside the vault that points elsewhere would otherwise let
   * reads/writes escape the vault root. Returns the fully resolved real path.
   */
  private async assertRealPathWithinRoot(absolute: string): Promise<string> {
    const realRoot = await fs.realpath(this.root);
    let existing = absolute;

    for (;;) {
      try {
        const realExisting = await fs.realpath(existing);
        const suffix = path.relative(existing, absolute);
        const resolved = suffix ? path.resolve(realExisting, suffix) : realExisting;
        assertWithinRoot(realRoot, resolved);
        return resolved;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = path.dirname(existing);
        if (parent === existing) throw error; // reached the filesystem root
        existing = parent;
      }
    }
  }

  async listNotes(options: { folder?: string; limit?: number } = {}): Promise<NoteSummary[]> {
    const start = options.folder ? this.resolveFolderPath(options.folder) : this.root;
    if (options.folder) await this.assertRealPathWithinRoot(start);
    const limit = clampLimit(options.limit, 200);
    const notes: NoteSummary[] = [];

    for await (const file of walkMarkdownFiles(start)) {
      notes.push(await this.summarize(file));
      if (notes.length >= limit) break;
    }

    return notes.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readNote(notePath: string): Promise<Note> {
    const absolute = this.resolveNotePath(notePath);
    await this.assertRealPathWithinRoot(absolute);
    const [content, stat] = await Promise.all([fs.readFile(absolute, "utf8"), fs.stat(absolute)]);

    return {
      path: this.relativePath(absolute),
      title: titleFromContent(content, absolute),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      content
    };
  }

  async searchNotes(options: { query: string; folder?: string; limit?: number }): Promise<SearchMatch[]> {
    const query = options.query.trim();
    if (!query) throw new Error("query is required");

    const start = options.folder ? this.resolveFolderPath(options.folder) : this.root;
    if (options.folder) await this.assertRealPathWithinRoot(start);
    const needle = query.toLowerCase();
    const limit = clampLimit(options.limit, 25);
    const matches: SearchMatch[] = [];

    for await (const file of walkMarkdownFiles(start)) {
      const content = await fs.readFile(file, "utf8");
      const index = content.toLowerCase().indexOf(needle);
      if (index === -1) continue;

      const summary = await this.summarize(file, content);
      matches.push({
        ...summary,
        snippet: snippetAround(content, index, query.length)
      });

      if (matches.length >= limit) break;
    }

    return matches;
  }

  async writeNote(options: { path: string; content: string; overwrite?: boolean }): Promise<NoteSummary> {
    const absolute = this.resolveNotePath(options.path);
    await this.assertRealPathWithinRoot(absolute);

    if (!options.overwrite) {
      try {
        await fs.stat(absolute);
        throw new Error(`Note already exists: ${this.relativePath(absolute)}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, ensureTrailingNewline(options.content), "utf8");
    return this.summarize(absolute);
  }

  async appendNote(options: { path: string; content: string; create?: boolean }): Promise<NoteSummary> {
    const absolute = this.resolveNotePath(options.path);
    await this.assertRealPathWithinRoot(absolute);
    await fs.mkdir(path.dirname(absolute), { recursive: true });

    try {
      await fs.appendFile(absolute, ensureLeadingBlankLine(options.content), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || options.create === false) {
        throw error;
      }
      await fs.writeFile(absolute, ensureTrailingNewline(options.content), "utf8");
    }

    return this.summarize(absolute);
  }

  private resolveFolderPath(input: string): string {
    const normalized = normalizeVaultRelativePath(input);
    const absolute = path.resolve(this.root, ...normalized.split("/"));

    assertWithinRoot(this.root, absolute, "Folder path escapes the vault root");

    return absolute;
  }

  private relativePath(absolute: string): string {
    return path.relative(this.root, absolute).split(path.sep).join("/");
  }

  private async summarize(absolute: string, knownContent?: string): Promise<NoteSummary> {
    const [stat, content] = await Promise.all([
      fs.stat(absolute),
      knownContent == null ? fs.readFile(absolute, "utf8") : Promise.resolve(knownContent)
    ]);

    return {
      path: this.relativePath(absolute),
      title: titleFromContent(content, absolute),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    };
  }
}

function assertWithinRoot(root: string, candidate: string, message = "Note path escapes the vault root"): void {
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (candidate !== root && !candidate.startsWith(rootWithSeparator)) {
    throw new VaultPathError(message);
  }
}

function normalizeVaultRelativePath(input: string): string {
  const trimmed = input.trim().replaceAll("\\", "/");

  if (!trimmed || trimmed.includes("\0")) {
    throw new VaultPathError("Path is empty or invalid");
  }

  if (trimmed.startsWith("/")) {
    throw new VaultPathError("Absolute paths are not allowed");
  }

  const normalized = path.posix.normalize(trimmed);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new VaultPathError("Path traversal is not allowed");
  }

  return normalized;
}

function normalizeNotePath(input: string): string {
  const normalized = normalizeVaultRelativePath(input);
  const extension = path.posix.extname(normalized);
  const withExtension = extension ? normalized : `${normalized}.md`;

  if (path.posix.extname(withExtension).toLowerCase() !== ".md") {
    throw new VaultPathError("Only Markdown note paths are allowed");
  }

  return withExtension;
}

async function* walkMarkdownFiles(directory: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name)) continue;
      yield* walkMarkdownFiles(path.join(directory, entry.name));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      yield path.join(directory, entry.name);
    }
  }
}

function titleFromContent(content: string, absolutePath: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return path.basename(absolutePath, path.extname(absolutePath));
}

function snippetAround(content: string, index: number, length: number): string {
  const start = Math.max(0, index - 90);
  const end = Math.min(content.length, index + length + 130);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  return `${prefix}${content.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, 500);
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function ensureLeadingBlankLine(content: string): string {
  const body = ensureTrailingNewline(content);
  return body.startsWith("\n") ? body : `\n${body}`;
}

