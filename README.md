# Obsidian MCP

Streamable HTTP MCP server for an Obsidian vault. It exposes Markdown notes as
MCP tools and includes MCP Apps resources for inline search and editing in
clients that support the MCP Apps extension.

The server is designed to run behind Cloudflare Access Managed OAuth. Cloudflare
handles the user OAuth flow; the origin validates Cloudflare Access assertions
when `CF_ACCESS_REQUIRED=true`.

## Installation

A prebuilt, multi-arch image (`linux/amd64`, `linux/arm64`) is published to the
GitHub Container Registry:

```
ghcr.io/kylemcd/obsidian-mcp:latest
```

Pull it:

```bash
docker pull ghcr.io/kylemcd/obsidian-mcp:latest
```

Use a pinned version tag (for example `:0.2.0`) for reproducible deploys;
`:latest` always points at the newest release.

### Quick start

Run the server against an already-synced local vault by disabling managed sync.
The container binds to `0.0.0.0`, so it will not start unauthenticated unless
you opt out explicitly — fine for a local trial, but configure Cloudflare Access
for any real deployment.

```bash
docker run --rm \
  -p 127.0.0.1:8787:8787 \
  -v /path/to/vault:/vault:ro \
  -e SYNC_ENABLED=false \
  -e CF_ACCESS_REQUIRED=false \
  ghcr.io/kylemcd/obsidian-mcp:latest

curl http://127.0.0.1:8787/health
```

### Production (Cloudflare Access)

```bash
docker run -d --name obsidian-mcp --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v obsidian-mcp-vault:/vault \
  -e OBSIDIAN_REMOTE_VAULT="<remote-vault-name-or-id>" \
  -e OBSIDIAN_AUTH_TOKEN="<obsidian-auth-token>" \
  -e CF_ACCESS_REQUIRED=true \
  -e CF_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com \
  -e CF_ACCESS_AUD=<access-application-aud> \
  -e CF_ACCESS_ALLOWED_EMAILS=you@example.com \
  -e ALLOWED_HOSTS=obsidian-mcp.example.com \
  ghcr.io/kylemcd/obsidian-mcp:latest
```

Front the loopback-bound port with Cloudflare Tunnel (or another reverse proxy)
and protect the hostname with a Cloudflare Access application. See
[Production Shape](#production-shape) for the full topology, the
[Configuration](#configuration) table for every variable, and the [Docker](#docker)
section for Compose, building locally, and the release flow.

For long-lived Claude connector sessions, configure the Access application's
Managed OAuth settings explicitly instead of relying on defaults:

- Enable Managed OAuth.
- Enable Dynamic Client Registration.
- Allow Claude redirect URIs:
  - `https://claude.ai/api/mcp/auth_callback`
  - `https://claude.com/api/mcp/auth_callback`
- Set a long Managed OAuth grant session duration, for example `720h` for about
  30 days.
- Set an access token lifetime that your MCP client refreshes reliably. A short
  value such as `15m` follows Cloudflare's default guidance; if a client
  repeatedly disconnects or prompts for re-auth because token refresh is flaky,
  use a longer value such as `24h`.

## Features

- List, read, and search Markdown notes in an Obsidian vault.
- Manage Obsidian Headless Sync by default, with an opt-out for externally
  synced vaults.
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
| `SYNC_ENABLED` | `true` | Runs managed Obsidian Headless Sync inside this process. Set to `false` when another service already keeps `VAULT_PATH` synced. |
| `SYNC_AUTO_SETUP` | `true` | Runs `ob sync-setup` automatically when `VAULT_PATH` is not already configured. |
| `OBSIDIAN_REMOTE_VAULT` | unset | Remote Obsidian Sync vault name or ID for first-time managed setup. Also accepted as `SYNC_REMOTE_VAULT`. |
| `OBSIDIAN_AUTH_TOKEN` | unset | Passed through to `obsidian-headless` for non-interactive authentication when supported by that client. |
| `OBSIDIAN_SYNC_PASSWORD` | unset | Optional end-to-end encryption password passed to `ob sync-setup --password`. Also accepted as `SYNC_PASSWORD`. |
| `OBSIDIAN_DEVICE_NAME` | `obsidian-mcp` | Device name passed to `ob sync-setup --device-name`. Also accepted as `SYNC_DEVICE_NAME`. |
| `SYNC_COMMAND` | `ob` | Command used to run Obsidian Headless. The Docker image includes `ob` on `PATH`. |
| `SYNC_RESTART_DELAY_MS` | `10000` | Delay before retrying setup or restarting sync after an exit. |
| `SYNC_STALE_AFTER_MS` | `600000` | Restart managed sync when it produces no output for this long. |
| `SYNC_RUNTIME_MAX_MS` | `21600000` | Recycle managed sync after this long even if it still appears healthy. |
| `SYNC_REQUIRED_FOR_READY` | `true` | Makes `/ready` return `503` until managed sync is configured, running, and fully synced. |
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

## Docker

Running the server on a host is the recommended deployment. See
[Installation](#installation) for `docker run` examples; this section covers
Compose, image details, building locally, and the release flow.

With Compose — copy `docker-compose.yml`, edit the volume path and environment,
then:

```bash
docker compose up -d
```

Image details:

- Mount or create the vault at `/vault` (the image default `VAULT_PATH`).
- Managed sync is enabled by default. Use a writable volume so
  `obsidian-headless` can download and update vault files.
- Set `SYNC_ENABLED=false` for an externally synced vault. In that mode, a
  read-only mount is fine unless you set `READ_ONLY=false` and intend to allow
  MCP write tools.
- The container binds to `HOST=0.0.0.0` so the published port works. Because
  that is a non-loopback bind, the server **refuses to start without
  authentication** unless you set `CF_ACCESS_REQUIRED=false` on purpose (see
  [Security configuration](#security-configuration)). Configure Cloudflare
  Access for any real deployment.
- The host port is mapped to `127.0.0.1` in the examples so only a local reverse
  proxy or Cloudflare Tunnel can reach it. Front it with Cloudflare Access for
  remote use.
- A `HEALTHCHECK` polls `/ready`; `docker ps` and Compose report unhealthy
  status when the vault or managed sync is not ready.

Build the image yourself instead of pulling:

```bash
docker build -t obsidian-mcp .
```

### Releasing

Releases are driven by the `version` field in `package.json`. Bump it and merge
to `main`; the `Publish Docker image` workflow detects the new version and then:

1. builds and pushes multi-arch (`linux/amd64`, `linux/arm64`) images to GHCR,
   tagged `:<version>`, `:<major.minor>`, and `:latest`;
2. pushes a `v<version>` git tag; and
3. creates a GitHub release with generated notes.

```bash
# example: cut version 0.2.0
npm version minor --no-git-tag-version   # or edit package.json by hand
git commit -am "chore: release v0.2.0"
git push origin main
```

The workflow is idempotent: if a `v<version>` tag already exists it does
nothing, so re-running or pushing unrelated commits will not republish. You can
also trigger it manually from the Actions tab (`workflow_dispatch`).

## Local Development

```bash
cp .env.example .env
pnpm install
SYNC_ENABLED=false READ_ONLY=true CF_ACCESS_REQUIRED=false VAULT_PATH=/path/to/vault pnpm dev
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
4. Managed OAuth has Dynamic Client Registration enabled and a grant session
   duration long enough for agent use. For Claude, allow
   `https://claude.ai/api/mcp/auth_callback` and
   `https://claude.com/api/mcp/auth_callback`.
5. The origin service listens on a private interface such as `127.0.0.1`.
6. The origin validates `Cf-Access-Jwt-Assertion` with `CF_ACCESS_TEAM_DOMAIN`
   and `CF_ACCESS_AUD`.

## Vault Sync

`VAULT_PATH` must point at a local filesystem copy of the Obsidian vault. In the
Docker image, managed sync is enabled by default and uses Obsidian Headless to
set up and run `ob sync --continuous` for that path. The server starts even when
managed sync is not ready, but `/ready` returns `503` until the vault exists and
sync has reached `Fully synced`.

Use managed sync for the default hosted path:

```bash
SYNC_ENABLED=true
VAULT_PATH=/vault
OBSIDIAN_REMOTE_VAULT=<remote-vault-name-or-id>
OBSIDIAN_AUTH_TOKEN=<token-used-by-obsidian-headless>
OBSIDIAN_SYNC_PASSWORD=<optional-e2ee-password>
```

Use unmanaged mode when another process already keeps the local vault current,
such as a separate systemd service, Git, Syncthing, or a host-level
Obsidian Headless Sync setup:

```bash
SYNC_ENABLED=false
VAULT_PATH=/path/to/already-synced/vault
```

Example production environment:

```bash
VAULT_PATH=/vault
VAULT_NAME=Obsidian
READ_ONLY=true
SYNC_ENABLED=true
OBSIDIAN_REMOTE_VAULT=<remote-vault-name-or-id>
OBSIDIAN_AUTH_TOKEN=<token-used-by-obsidian-headless>
CF_ACCESS_REQUIRED=true
CF_ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com
CF_ACCESS_AUD=<access-application-aud>
CF_ACCESS_ALLOWED_EMAILS=<user@example.com>
ALLOWED_ORIGINS=https://claude.ai
ALLOWED_HOSTS=obsidian-mcp.example.com
RATE_LIMIT_PER_MINUTE=300
MCP_PUBLIC_URL=https://obsidian-mcp.example.com/mcp
```
