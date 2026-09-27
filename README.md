# drafts-mcp-bridge

Authenticated Streamable HTTP bridge for
[`@agiletortoise/drafts-mcp-server`](https://github.com/agiletortoise/drafts-mcp-server).

Use this when an MCP client needs remote access to Drafts on your Mac. The
upstream Drafts MCP server is a local stdio process; this repo wraps it in a
small authenticated Streamable HTTP server.

What it does:

- installs the published `@agiletortoise/drafts-mcp-server` package as a pinned dependency
- launches that package locally as a child stdio MCP process
- exposes MCP over HTTP at `/mcp`
- requires Bearer auth on every request
- defaults to read-only tool exposure
- optionally publishes the bridge through Tailscale Serve at `/drafts-mcp`

What it does not do:

- it does not import upstream server internals
- it does not require the upstream repo to become a monorepo
- it does not make Drafts itself remote; Drafts stays on the Mac

## Requirements

- macOS with Drafts installed and automation access allowed
- Node.js 24+
- pnpm 11+, only for building or running from source
- Tailscale, only if using `pnpm start:tailscale`

## Quick Start

```sh
pnpm install
pnpm token:generate
pnpm start
```

Default local endpoint:

```text
http://127.0.0.1:3060/mcp
```

Clients must send:

```text
Authorization: Bearer <contents of ~/.config/drafts-mcp-bridge/token>
```

Smoke test:

```sh
TOKEN="$(cat "${XDG_CONFIG_HOME:-$HOME/.config}/drafts-mcp-bridge/token")"

curl -i http://127.0.0.1:3060/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

`pnpm token:generate` writes `~/.config/drafts-mcp-bridge/token` (or the
corresponding `XDG_CONFIG_HOME` path) with directory mode `0700` and file mode
`0600`, and does not print the token. Rotate it with:

```sh
pnpm token:generate -- --force
```

## Standalone Release

Build a portable archive from this checkout:

```sh
pnpm install --frozen-lockfile
pnpm build:release
```

This produces `release/drafts-mcp-bridge.tar.gz`. It bundles the bridge,
the pinned upstream server, and their JavaScript dependencies. Copy and extract
the archive on your Mac; no `node_modules`, pnpm, or build step is needed there.
Node.js 24+ and Drafts are still required, plus Tailscale when using Serve.

```sh
tar -xzf drafts-mcp-bridge.tar.gz
cd drafts-mcp-bridge
./scripts/generate-token.sh
./scripts/run-server.sh
# Or, for tailnet HTTPS:
./scripts/run-tailscale.sh
```

The optional `.env` lives in the extracted directory. The token lives in the
shared user config directory, outside the checkout and release. The archive
contains no `.env` or tokens. You can install the release as a LaunchAgent with
`./scripts/install-launch-agent.sh`; keep its directory in place afterward.
Rotate a release token with `./scripts/generate-token.sh --force`.
Bundled dependency licenses are included in `THIRD_PARTY_NOTICES.txt`.

Rebuild the release after changing source code. Source checkout commands still
compile before starting; release scripts execute the bundled `.mjs` files.

## Security

- Bearer auth is required on every request.
- The bridge refuses to start without `DRAFTS_MCP_TOKEN`,
  `DRAFTS_MCP_TOKEN_FILE`, or the default user-config token.
- Token files must be regular files, not symbolic links, with no group/world
  permissions. The default token directory must also have no group/world permissions.
- The default bind host is `127.0.0.1`.
- Read-only mode is enabled by default. Set `DRAFTS_MCP_READ_ONLY=false` only
  when remote mutation is intended.
- The upstream Drafts server stays local to the Mac and is launched over
  stdio; no upstream internals are imported.

## Configuration

`.env` is optional. If present, it is loaded before process environment values,
so shell, launchd, or service-manager env vars override `.env`.

### Where the MCP token comes from

This is a locally generated bearer token for authenticating clients to the bridge.
Drafts and Tailscale do not supply it. Configure your MCP client to send the same
value in its `Authorization: Bearer ...` header.

After loading configuration, the bridge selects the first applicable source:

1. A non-empty `DRAFTS_MCP_TOKEN` from the effective environment.
2. The file named by `DRAFTS_MCP_TOKEN_FILE`.
3. `$XDG_CONFIG_HOME/drafts-mcp-bridge/token`, or
   `~/.config/drafts-mcp-bridge/token` when `XDG_CONFIG_HOME` is unset.
   `XDG_CONFIG_HOME` must be an absolute path.

Both variables can come from the process environment or `.env`; process values
override the same variable in `.env`. Relative `DRAFTS_MCP_TOKEN_FILE` paths are
resolved beside the loaded `.env` file, or against the working directory when
there is no `.env`. Absolute paths are used unchanged. An explicitly selected
file that is missing, empty, or has unsafe permissions causes startup to fail;
it does not fall back to another token.

All startup methods use the same default token, independent of the checkout,
release location, or working directory. The LaunchAgent installer records the
config-home path so a custom `XDG_CONFIG_HOME` survives login. Token overrides
in `.env` are honored by the Tailscale launcher too.

`pnpm token:generate` (source) or `./scripts/generate-token.sh` (release) always
writes the default user-config token; it does not write a custom
`DRAFTS_MCP_TOKEN_FILE`. It creates the application directory with mode `0700`
and the token with mode `0600`; rotation also repairs these permissions.
The LaunchAgent installer validates the selected token using the same
configuration and permission checks as startup.

Generate the token once in the user config directory, then configure the MCP
client with its value. Source checkouts and extracted releases share that token.
The archive contains no token.

| Variable | Default | Description |
| --- | --- | --- |
| `DRAFTS_MCP_TOKEN_FILE` | User-config `drafts-mcp-bridge/token` when present | Private file containing the bearer token. |
| `DRAFTS_MCP_TOKEN` | none | Direct bearer token override. Avoid inline shell usage because it can leak through history. |
| `DRAFTS_MCP_ENV_FILE` | `.env` when present | Optional dotenv file path. If explicitly set, the file must exist. |
| `DRAFTS_MCP_HOST` | `127.0.0.1` | HTTP bind host. Keep this as `127.0.0.1` for Tailscale Serve mode. |
| `DRAFTS_MCP_PORT` | `3060` | HTTP bind port. |
| `DRAFTS_MCP_READ_ONLY` | `true` | Set to `false` to expose mutating upstream tools. |
| `DRAFTS_MCP_VERBOSE` | `false` | Set to `true` for redacted request logs. |
| `DRAFTS_MCP_UPSTREAM_COMMAND` | Node executable | Optional override for the stdio upstream command. |
| `DRAFTS_MCP_UPSTREAM_ARGS` | resolved upstream bin path | Optional override args. Must be a JSON array of strings, such as `["--flag", "value"]`. Shell-like strings are no longer accepted. |

To bind plain HTTP to one trusted interface, set `DRAFTS_MCP_HOST` to that
interface's IP address, such as a Tailscale or LAN address. Setting it to
`0.0.0.0` exposes the bridge on every IPv4 interface and is discouraged. Direct
binding is not HTTPS; prefer Tailscale Serve for remote access.

## Tailscale Serve

For tailnet HTTPS:

```sh
pnpm start:tailscale
```

This starts the bridge on `127.0.0.1:${DRAFTS_MCP_PORT:-3060}` and registers a
persistent background Tailscale Serve route. With the default port, the Serve
command is:

```sh
tailscale serve --bg --set-path /drafts-mcp http://127.0.0.1:3060/mcp
```

Remote endpoint:

```text
https://<mac-name>.<tailnet>.ts.net/drafts-mcp
```

The wrapper accepts an existing `/drafts-mcp` route when it already points to
the expected local bridge. It refuses to overwrite a route pointing elsewhere,
leaves unrelated Serve routes alone, and does not run `tailscale serve reset`.

## Run in the Background

Use a macOS LaunchAgent, not a LaunchDaemon, so Drafts automation runs in the
logged-in user's GUI session.

```sh
pnpm launchd:install
```

This renders `launchd/local.drafts-mcp-bridge.plist.template` to:

```text
~/Library/LaunchAgents/local.drafts-mcp-bridge.plist
```

The service runs an installed copy of `scripts/drafts-mcp-bridge.sh`, so
macOS Login Items show a named bridge entry instead of `pnpm`. The installed
launcher lives outside `~/Documents` to avoid macOS background-item privacy
restrictions, keeps the bridge alive, and writes logs to:

```text
~/Library/Logs/drafts-mcp-bridge/
```

Check status:

```sh
launchctl print "gui/$(id -u)/local.drafts-mcp-bridge"
pnpm launchd:logs
```

Uninstall:

```sh
pnpm launchd:uninstall
```

## Upstream Launch

The upstream package is pinned in `package.json`. Release builds launch the
bundled `dist/upstream.mjs`; source builds:

1. resolves `@agiletortoise/drafts-mcp-server/package.json`
2. reads the package `bin` entry
3. starts `node <resolved-bin-path>` as a child stdio MCP process

Override launch only when testing a different stdio server:

```sh
DRAFTS_MCP_UPSTREAM_COMMAND=node \
DRAFTS_MCP_UPSTREAM_ARGS='["/absolute/path/to/custom/server.js"]' \
pnpm start
```

## Read-Only Mode

When `DRAFTS_MCP_READ_ONLY` is unset or true, only these tools are exposed:

- `drafts_list_workspaces`
- `drafts_list_tags`
- `drafts_get_tag`
- `drafts_get_current_workspace`
- `drafts_get_current`
- `drafts_get_workspace_drafts`
- `drafts_get_drafts`
- `drafts_get_draft`
- `drafts_search`
- `drafts_list_actions`
- `drafts_open`

Mutating tools, action execution, `drafts_open_workspace`, and unknown future
tools are blocked in read-only mode. `drafts_open` is intentionally allowed: it
does not change draft data and can open Drafts or bring a selected draft into
the editor. The allowlist is tied to the pinned upstream package inventory and
must be reviewed when that dependency changes.

## Diagnostics

Enable redacted request logs:

```sh
pnpm start:tailscale -- --verbose
```

or:

```sh
DRAFTS_MCP_VERBOSE=true pnpm start:tailscale
```

Verbose logs include method, path, status, duration, remote address,
forwarded-for, user agent, content type, accept header, whether an Authorization
header was present, and whether bearer auth passed. They do not include bearer
tokens or request bodies.

If a client gets `502 Bad Gateway` and no bridge request log appears, the request
did not reach the bridge. Check:

```sh
tailscale serve status --json
lsof -nP -iTCP:3060 -sTCP:LISTEN
```

If the bridge logs `statusCode:401`, the request reached the bridge but the
token was missing or invalid.

## Development

The project pins pnpm 11.28.0. CI checks formatting, lint, types, tests, and builds.
Dependency audits cover runtime and development dependencies on pull requests,
pushes to `main`, and daily at 00:00 UTC. Moderate or higher severity advisories
fail the audit job. Run the same scan locally with `pnpm audit --audit-level moderate`.

```sh
pnpm install
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

Most tests use a fake stdio MCP child process. Release tests extract the archive
outside the repository and start the bundled upstream server with pnpm disabled
and no `node_modules`. They list tools, call a read-only tool, and check
authentication with AppleScript and Tailscale commands simulated; they do not
access your Drafts data.

`pnpm start`, `pnpm start:tailscale`, and `pnpm token:generate` run
`pnpm run build` before executing compiled output.
