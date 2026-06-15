# Obsidian MCP

Streamable HTTP MCP server for an Obsidian vault. It exposes Markdown notes as
MCP tools and includes MCP Apps resources for inline search and editing in
clients that support the MCP Apps extension.

The server is designed to run behind Cloudflare Access Managed OAuth. Cloudflare
handles the user OAuth flow; the origin validates Cloudflare Access assertions
when `CF_ACCESS_REQUIRED=true`.

## Features

- List, read, and search Markdown notes in an Obsidian vault.
- Create, overwrite, and append Markdown notes when `READ_ONLY=false`.
- Reject paths that escape the vault root and only operate on Markdown note
  paths.
- Serve MCP over Streamable HTTP at `/mcp` by default.
- Serve legacy SSE transport at `/sse` and `/messages`.
- Advertise MCP Apps support with `text/html;profile=mcp-app`.
- Render an interactive search UI with selectable results and inline Markdown
  editing.
- Render an interactive note editor for opening a specific note.
- Keep all vault reads and writes server-side through MCP tools.
- Validate Cloudflare Access JWT assertions and optional email allowlists.
- Provide OAuth metadata and authorization redirects compatible with
  Cloudflare Access Managed OAuth.

## Tools

| Tool | Description |
| --- | --- |
| `vault_status` | Returns vault name, vault path, read-only state, and Cloudflare Access identity context. |
| `list_notes` | Lists Markdown notes, optionally scoped to a vault-relative folder. |
| `read_note` | Reads one Markdown note by vault-relative path. The `.md` extension is optional. |
| `search_notes` | Searches Markdown notes with a case-insensitive plain-text query. |
| `search_notes_interactive` | Searches notes and renders an MCP Apps search/editor UI when supported by the client. |
| `edit_note_interactive` | Opens one note in an MCP Apps Markdown editor when supported by the client. |
| `write_note` | Creates or overwrites a Markdown note. Disabled when `READ_ONLY=true`. |
| `append_note` | Appends Markdown to a note. Disabled when `READ_ONLY=true`. |

## MCP Apps

The server uses the official MCP Apps extension for interactive UI resources.
Clients without MCP Apps support can still use the text tools.

| Resource | URI |
| --- | --- |
| Search results editor | `ui://obsidian/search` |
| Note editor | `ui://obsidian/note-editor` |

The app resources are returned with MIME type `text/html;profile=mcp-app`.
Interactive UIs call `read_note`, `search_notes`, and `write_note` through the
MCP Apps host bridge. They do not read files directly or call private HTTP
endpoints.

Markdown edits are local to the iframe until the user presses Save. Save calls
`write_note` with `overwrite: true`; no editor auto-save is used.

For Claude MCP Apps, set `MCP_APP_RESOURCE_DOMAIN` to the expected
`<hash>.claudemcpcontent.com` sandbox domain. If `MCP_APP_RESOURCE_DOMAIN` is not
set, the server derives it from `MCP_PUBLIC_URL` or `PUBLIC_MCP_URL` by hashing
the public MCP URL.

## HTTP Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /health` | Basic service status. |
| `GET /ready` | Verifies the configured vault path exists and is a directory. |
| `POST /mcp` | Streamable HTTP MCP requests. |
| `GET /mcp` | Streamable HTTP session request endpoint. |
| `DELETE /mcp` | Streamable HTTP session deletion endpoint. |
| `GET /sse` | Legacy SSE transport connection. |
| `POST /messages` | Legacy SSE message endpoint. |
| `GET /.well-known/oauth-authorization-server` | Cloudflare Access OAuth authorization server metadata. |
| `GET /.well-known/openid-configuration` | Cloudflare Access OpenID-compatible metadata. |
| `GET /.well-known/oauth-protected-resource` | Protected-resource metadata for the MCP endpoint. |
| `GET /.well-known/oauth-protected-resource/mcp` | Protected-resource metadata for the MCP endpoint. |
| `GET /.well-known/cloudflare-access-protected-resource/mcp` | Cloudflare Access protected-resource metadata. |
| `GET /authorize` | Redirects authorization requests to Cloudflare Access Managed OAuth. |
| `GET /oauth/authorize` | Redirects authorization requests to Cloudflare Access Managed OAuth. |

## Configuration

Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP bind host. |
| `PORT` | `8787` | HTTP bind port. |
| `MCP_PATH` | `/mcp` | Streamable HTTP MCP path. |
| `VAULT_PATH` | current working directory | Obsidian vault root. |
| `VAULT_NAME` | `Obsidian` | Vault name reported by `vault_status`. |
| `READ_ONLY` | `true` | Disables `write_note` and `append_note` unless set to `false`, `0`, `no`, or `off`. |
| `ALLOWED_ORIGINS` | empty | Optional comma-separated browser Origin allowlist. Empty allows all origins. A non-empty value also enables Origin validation on the MCP transport. |
| `ALLOWED_HOSTS` | empty | Optional comma-separated `Host` header allowlist for DNS-rebinding protection. Must match the exact Host the origin receives, including a non-standard port. Empty disables Host validation. |
| `RATE_LIMIT_PER_MINUTE` | `300` | Per-client request budget for the MCP and SSE endpoints, keyed by `cf-connecting-ip`. `0` disables the limiter. |
| `MCP_APP_RESOURCE_DOMAIN` | unset | Explicit MCP Apps resource sandbox domain. |
| `MCP_PUBLIC_URL` | unset | Public MCP URL used to derive a Claude MCP Apps resource domain. |
| `PUBLIC_MCP_URL` | unset | Alternate public MCP URL used to derive a Claude MCP Apps resource domain. |
| `CF_ACCESS_REQUIRED` | derived | Requires Cloudflare Access validation when true. Defaults to true when team domain and audience are configured. See [Security configuration](#security-configuration) for the fail-closed startup rules. |
| `CF_ACCESS_TEAM_DOMAIN` | unset | Cloudflare Access team domain, with or without `https://`. |
| `TEAM_DOMAIN` | unset | Alternate name for `CF_ACCESS_TEAM_DOMAIN`. |
| `CF_ACCESS_AUD` | unset | Cloudflare Access application audience. |
| `POLICY_AUD` | unset | Alternate name for `CF_ACCESS_AUD`. |
| `CF_ACCESS_ALLOWED_EMAILS` | empty | Optional comma-separated email allowlist after JWT validation. |

Truthy boolean values are `1`, `true`, `yes`, and `on`.

## Security configuration

The server protects the vault in layers. The first two matter most; the rest are
defense in depth.

### Authentication fails closed

The server refuses to start in misconfigured states rather than silently serving
the vault without authentication:

- If `CF_ACCESS_REQUIRED=true` but `CF_ACCESS_TEAM_DOMAIN` or `CF_ACCESS_AUD` is
  missing, startup throws — the origin will not accept tokens it cannot verify.
- If authentication resolves to off (no team domain/audience and
  `CF_ACCESS_REQUIRED` is not explicitly set) and `HOST` is **not** loopback,
  startup throws. Bind to `127.0.0.1` for local development, or set
  `CF_ACCESS_REQUIRED=false` to run unauthenticated on a public interface on
  purpose.

Note that this is a behavioral change: a deploy that sets a non-loopback `HOST`
without configuring Access now errors at boot until you either configure
Cloudflare Access or explicitly opt out with `CF_ACCESS_REQUIRED=false`.

### Identity allowlist

When `CF_ACCESS_REQUIRED=true`, every identity your Cloudflare Access policy
admits can use the vault unless you narrow it. Set `CF_ACCESS_ALLOWED_EMAILS` to
restrict access to specific users (matched case-insensitively against the `email`
claim). The server logs a warning at startup when Access is required but no email
allowlist is configured.

### Path containment

All tool paths are normalized and rejected if they escape the vault root, are
absolute, or are not Markdown. In addition, reads and writes resolve symlinks on
the target's deepest existing ancestor and re-check containment, so a symlink
inside the vault that points elsewhere cannot be used to read or write outside
the vault root.

### Network boundary

- `ALLOWED_ORIGINS` is a browser Origin allowlist. A non-empty value also enables
  Origin validation on the MCP transport. Requests without an `Origin` header
  (typical of non-browser MCP clients) are still allowed.
- `ALLOWED_HOSTS` enables `Host`-header validation to block DNS-rebinding
  attacks. Set it to the exact Host the origin receives — for example
  `ALLOWED_HOSTS=obsidian-mcp.example.com` for standard HTTPS, adding loopback
  entries such as `127.0.0.1:8787,localhost:8787` if you also reach it locally.
  Include a port only when it actually appears in the Host header. The Host the
  origin receives is used for OAuth resource metadata only when it is on this
  allowlist; otherwise the configured `HOST`/`PORT` is used.
- `RATE_LIMIT_PER_MINUTE` caps requests per client (keyed by `cf-connecting-ip`).
  This is a process-local backstop; Cloudflare's own rate limiting should be the
  primary control in front of the origin.

## Local Development

```bash
cp .env.example .env
pnpm install
READ_ONLY=true CF_ACCESS_REQUIRED=false VAULT_PATH=/path/to/vault pnpm dev
```

Health checks:

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/ready
```

## Production Shape

The usual deployment shape is:

1. A public hostname routes to the local server through Cloudflare Tunnel or an
   equivalent reverse proxy.
2. A Cloudflare Access self-hosted application protects that hostname.
3. Cloudflare Access Managed OAuth is enabled for MCP clients.
4. The origin service listens on a private interface such as `127.0.0.1`.
5. The origin validates `Cf-Access-Jwt-Assertion` with `CF_ACCESS_TEAM_DOMAIN`
   and `CF_ACCESS_AUD`.

## Vault Sync

`VAULT_PATH` must point at a local filesystem copy of the Obsidian vault. This
server does not sync a vault by itself; it reads and writes the Markdown files
already present at that path.

For hosted deployments, run a separate sync process that keeps the local vault
current before starting this server. That can be an Obsidian headless sync
service, Obsidian Sync running under a headless wrapper, Git, Syncthing, or any
other mechanism that maintains a local Markdown vault directory.

Example production environment:

```bash
VAULT_PATH=/path/to/vault
VAULT_NAME=Obsidian
READ_ONLY=true
CF_ACCESS_REQUIRED=true
CF_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com
CF_ACCESS_AUD=<access-application-aud>
CF_ACCESS_ALLOWED_EMAILS=<user@example.com>
ALLOWED_ORIGINS=https://claude.ai
ALLOWED_HOSTS=obsidian-mcp.example.com
RATE_LIMIT_PER_MINUTE=300
MCP_PUBLIC_URL=https://obsidian-mcp.example.com/mcp
```
