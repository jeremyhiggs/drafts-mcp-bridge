# Drafts MCP bridge

Run the [Drafts MCP server](https://github.com/agiletortoise/drafts-mcp-server) on a Mac and connect to it through authenticated Streamable HTTP. The bridge starts the pinned upstream server locally over stdio. It listens at `http://127.0.0.1:3060/mcp` and can optionally expose that endpoint to your tailnet through Tailscale Serve.

**The LaunchAgent runs locally by default.** Set `DRAFTS_MCP_TAILSCALE_SERVE=true` in `~/.config/drafts-mcp-bridge/config.env` to make it run the Tailscale wrapper too. That registers `/drafts-mcp` as a tailnet-only HTTPS route. The bridge always requires a bearer token; tailnet access does not replace authentication.

## First-time setup: background service

You need macOS with Drafts installed and automation access allowed, Node.js 24+, and pnpm 11.28.0 to build. Tailscale is needed only if you enable Serve. Run these commands from this checkout:

```sh
pnpm install --frozen-lockfile
pnpm token:generate
```

Run `pnpm token:generate` only once for a new installation. It creates a private token at `$XDG_CONFIG_HOME/drafts-mcp-bridge/token`, or `~/.config/drafts-mcp-bridge/token` when `XDG_CONFIG_HOME` is unset. It does not print the token. The token directory has mode `0700`; the file has mode `0600`.

If you want the LaunchAgent to register a Tailscale Serve route, install and connect Tailscale, then put this line in `$XDG_CONFIG_HOME/drafts-mcp-bridge/config.env` (default `~/.config/drafts-mcp-bridge/config.env`) **before installing the agent**:

```dotenv
DRAFTS_MCP_TAILSCALE_SERVE=true
```

Keep `config.env` at mode `0600`. Without this setting, the LaunchAgent serves only on localhost. The installer requires the `tailscale` command only when this setting is true.

Build and install:

```sh
pnpm release
pnpm launchd:install
```

The installer checks the token and configuration, copies the standalone release into `~/Library/Application Support/drafts-mcp-bridge/releases/`, and starts `local.drafts-mcp-bridge`. The installed copy needs Node.js, but neither pnpm nor `node_modules`. After the new agent is running, the installer removes older installed releases. It does not copy a local `.env` into the installed release. When Serve is enabled, the LaunchAgent registers `/drafts-mcp` as part of startup.

Check the service:

```sh
launchctl print "gui/$(id -u)/local.drafts-mcp-bridge"
```

If Serve is enabled, check its route:

```sh
tailscale serve status
```

Look for `/drafts-mcp` pointing to `http://127.0.0.1:3060/mcp`. Configure your remote MCP client with the URL shown by `tailscale serve status`, followed by `/drafts-mcp`, and this header:

```text
Authorization: Bearer <contents of ~/.config/drafts-mcp-bridge/token>
```

With a custom `XDG_CONFIG_HOME`, read the token from that directory instead. A client on the Mac can always use `http://127.0.0.1:3060/mcp` with the same header, whether Serve is enabled or not.

## Configuration

For the LaunchAgent, put optional settings in `$XDG_CONFIG_HOME/drafts-mcp-bridge/config.env` (default `~/.config/drafts-mcp-bridge/config.env`). Keep that file at mode `0600` and its directory at `0700`. You do not need a config file for the defaults: the bridge binds to `127.0.0.1:3060` and exposes read-only tools.

For example, put this line in `config.env` only if remote clients should be able to change Drafts data:

```dotenv
DRAFTS_MCP_READ_ONLY=false
```

A `.env` in the checkout or a directly run release is a **local override**. Configuration is loaded in this order, with later values winning: user `config.env`, local `.env`, process environment. The installed LaunchAgent has no `.env`, so it uses the user config file. An explicit `DRAFTS_MCP_ENV_FILE` selects a local override file and must point to an existing file. The installer records `XDG_CONFIG_HOME` in the LaunchAgent so a custom config location survives login.

| Setting | Default | Purpose |
| --- | --- | --- |
| `DRAFTS_MCP_HOST` | `127.0.0.1` | Bind address. Tailscale Serve mode requires `127.0.0.1` or `localhost`. |
| `DRAFTS_MCP_PORT` | `3060` | Local HTTP port. Keep the default for the easiest Serve setup. |
| `DRAFTS_MCP_READ_ONLY` | `true` | Set to `false` to expose mutating tools. |
| `DRAFTS_MCP_VERBOSE` | `false` | Enable redacted request logs. |
| `DRAFTS_MCP_TAILSCALE_SERVE` | `false` | Register `/drafts-mcp` with Tailscale Serve when the LaunchAgent starts. |
| `DRAFTS_MCP_TOKEN_FILE` | User-config `token` file | Use another private bearer-token file. |
| `DRAFTS_MCP_TOKEN` | unset | Direct token override; avoid typing it into shell history. |
| `DRAFTS_MCP_UPSTREAM_COMMAND` | Node.js | Override the stdio server command for testing. |
| `DRAFTS_MCP_UPSTREAM_ARGS` | Bundled upstream entry point | JSON array of arguments for an override command. |

A non-empty `DRAFTS_MCP_TOKEN` takes precedence over `DRAFTS_MCP_TOKEN_FILE`; otherwise the bridge reads the default user-config token. Token files must be regular files, not symlinks, with no group or world permissions. A missing or unsafe explicitly selected token file makes startup fail. Relative token paths from `config.env` resolve beside that file. Relative paths from a local `.env` or process environment resolve beside the local `.env` when present, or against the working directory otherwise.

The bridge allows only read-only upstream tools by default. `drafts_open` remains available and may open Drafts or bring a draft into the editor; mutating tools and action execution are hidden. Directly binding plain HTTP to a LAN or Tailscale IP is possible through `DRAFTS_MCP_HOST`, but it is not HTTPS. Prefer the default loopback bind with Tailscale Serve.

## Other ways to run

For a foreground, local-only server from the checkout (regardless of the LaunchAgent's Serve setting):

```sh
pnpm start
```

For a foreground server that also registers the Tailscale Serve route (regardless of the config setting):

```sh
pnpm start:tailscale
```

Stop the LaunchAgent first if you use either foreground command on the same port. The Serve route is persistent; the wrapper accepts an existing `/drafts-mcp` route when it points to this bridge, refuses to overwrite a different target, and leaves unrelated Serve routes alone.

Turning `DRAFTS_MCP_TAILSCALE_SERVE` back to `false` stops future registration, but a previously created background Serve route remains until you remove it. Remove only this path with `tailscale serve --https=443 --set-path=/drafts-mcp off`, then check `tailscale serve status`. Do not use `tailscale serve reset` if you have other routes. See [Tailscale's Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve#disable-tailscale-serve).

To build an archive for another Mac:

```sh
pnpm release
```

Copy `release/drafts-mcp-bridge.tar.gz` to that Mac, then extract and run it:

```sh
tar -xzf drafts-mcp-bridge.tar.gz
cd drafts-mcp-bridge
./scripts/generate-token.sh  # only if that Mac has no token yet
./scripts/install-launch-agent.sh
```

You can run `./scripts/run-server.sh` or `./scripts/run-tailscale.sh` in the foreground instead. The archive bundles the bridge, pinned upstream server, scripts, and dependency licenses. It contains no `.env`, token, `node_modules`, or pnpm dependency. Node.js 24+ and Drafts are still required; Tailscale is required only when Serve is enabled.

Check a release version without starting it:

```sh
./scripts/run-server.sh --version
```

Release versions append a fingerprint of the bundled code and runtime scripts, such as `0.1.0+1a2b3c4d5e6f`. Source runs report the package version without that fingerprint. The startup log and MCP initialization response report the running version.

## Updating and troubleshooting

Rebuild and reinstall to update the LaunchAgent:

```sh
pnpm release
pnpm launchd:install
```

The agent runs from its Application Support copy, so rebuilding the checkout alone does not update it. The installer keeps the user config and token outside the release and removes the prior installed version only after the replacement starts.

```sh
pnpm launchd:logs
launchctl print "gui/$(id -u)/local.drafts-mcp-bridge"
tailscale serve status
```

A `401` response means the request reached the bridge without a valid bearer token. A `502` with no bridge request log suggests the request did not reach the bridge; check `tailscale serve status` and the local listener with `lsof -nP -iTCP:3060 -sTCP:LISTEN`. To enable redacted request logs, set `DRAFTS_MCP_VERBOSE=true` in the user config file and reinstall. Logs omit tokens and request bodies.

Rotate the token with `pnpm token:generate -- --force`, then update your MCP clients. `pnpm launchd:uninstall` removes the LaunchAgent; it does not remove the user config, token, installed release files, or the persistent Tailscale Serve route.

## Development

The project pins pnpm 11.28.0. CI checks formatting, lint, types, tests, builds, and runtime plus development dependency advisories on pull requests and pushes to `main`. The dependency audit also runs daily at 00:00 UTC and fails on moderate or higher severity advisories.

```sh
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm audit --audit-level moderate
```

Tests use a fake stdio MCP server and a standalone archive without `node_modules`. AppleScript, Tailscale, and launchctl commands are simulated; tests do not access your Drafts data.
