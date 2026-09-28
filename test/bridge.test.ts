import path from "node:path";
import { fileURLToPath } from "node:url";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { defaultTokenFile, loadConfig } from "../src/config.js";
import { formatAddressForUrl, startBridge, type BridgeRuntime } from "../src/server.js";
import { connectUpstream, type UpstreamConnection } from "../src/upstream.js";
import { BRIDGE_VERSION } from "../src/version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fakeUpstreamPath = path.join(__dirname, "fixtures", "fake-upstream.mjs");

let runtime: BridgeRuntime | undefined;
let upstream: UpstreamConnection | undefined;

afterEach(async () => {
  if (runtime) {
    await runtime.close();
    runtime = undefined;
    upstream = undefined;
  } else if (upstream) {
    await upstream.close();
    upstream = undefined;
  }
});

describe("config", () => {
  test("fails closed when the bearer token is missing", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "drafts-bridge-"));

    expect(() =>
      loadConfig(
        {
          DRAFTS_MCP_TOKEN: "",
          XDG_CONFIG_HOME: tempDir,
        },
        { cwd: tempDir },
      ),
    ).toThrow(/A bearer token is required/);
  });

  test("defaults remote access to read-only mode", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "drafts-bridge-"));
    const config = loadConfig(
      {
        DRAFTS_MCP_TOKEN: "test-token",
      },
      { cwd: tempDir },
    );

    expect(config.readOnly).toBe(true);
  });

  test("enables verbose mode from env or load options", () => {
    expect(
      loadConfig({
        DRAFTS_MCP_TOKEN: "test-token",
        DRAFTS_MCP_VERBOSE: "true",
      }).verbose,
    ).toBe(true);

    expect(
      loadConfig(
        {
          DRAFTS_MCP_TOKEN: "test-token",
          DRAFTS_MCP_VERBOSE: "false",
        },
        {
          verbose: true,
        },
      ).verbose,
    ).toBe(true);
  });

  test("loads bearer token from the default private token file without .env", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "drafts-bridge-"));
    const tokenPath = defaultTokenFile({ XDG_CONFIG_HOME: tempDir });
    await mkdir(path.dirname(tokenPath), { mode: 0o700 });
    await writeFile(tokenPath, "default-file-token\n", { mode: 0o600 });

    const config = loadConfig({ XDG_CONFIG_HOME: tempDir }, { cwd: tmpdir() });

    expect(config.token).toBe("default-file-token");
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3060);
    expect(config.readOnly).toBe(true);
  });

  test("loads non-secret config from .env and bearer token from a private file", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "drafts-bridge-"));
    const tokenPath = path.join(tempDir, "token");
    await writeFile(tokenPath, "file-token\n", { mode: 0o600 });
    await writeFile(
      path.join(tempDir, ".env"),
      [
        `DRAFTS_MCP_TOKEN_FILE=${tokenPath}`,
        "DRAFTS_MCP_HOST=100.64.0.10",
        "DRAFTS_MCP_PORT=4444",
        "DRAFTS_MCP_READ_ONLY=false",
      ].join("\n"),
    );

    const config = loadConfig({}, { cwd: tempDir });

    expect(config.token).toBe("file-token");
    expect(config.host).toBe("100.64.0.10");
    expect(config.port).toBe(4444);
    expect(config.readOnly).toBe(false);
  });

  test("environment variables override .env values", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "drafts-bridge-"));
    const tokenPath = path.join(tempDir, "token");
    await writeFile(tokenPath, "file-token\n", { mode: 0o600 });
    await writeFile(
      path.join(tempDir, ".env"),
      [`DRAFTS_MCP_TOKEN_FILE=${tokenPath}`, "DRAFTS_MCP_PORT=4444"].join("\n"),
    );

    const config = loadConfig(
      {
        DRAFTS_MCP_TOKEN: "env-token",
        DRAFTS_MCP_PORT: "5555",
      },
      { cwd: tempDir },
    );

    expect(config.token).toBe("env-token");
    expect(config.port).toBe(5555);
  });

  test("honors an upstream args override without requiring a command override", () => {
    const config = loadConfig({
      DRAFTS_MCP_TOKEN: "test-token",
      DRAFTS_MCP_UPSTREAM_ARGS: '["--example", "value"]',
    });

    expect(config.upstreamCommand).toBe(process.execPath);
    expect(config.upstreamArgs).toEqual(["--example", "value"]);
  });

  test("does not pass default upstream args to a command-only override", () => {
    const config = loadConfig({
      DRAFTS_MCP_TOKEN: "test-token",
      DRAFTS_MCP_UPSTREAM_COMMAND: "/usr/bin/true",
    });

    expect(config.upstreamCommand).toBe("/usr/bin/true");
    expect(config.upstreamArgs).toEqual([]);
  });

  test("resolves a relative token file path from an explicit env file directory", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "drafts-bridge-"));
    const envPath = path.join(tempDir, "bridge.env");
    const tokenPath = path.join(tempDir, ".secrets", "token");
    await mkdir(path.dirname(tokenPath));
    await writeFile(tokenPath, "relative-file-token\n", { mode: 0o600 });
    await writeFile(envPath, "DRAFTS_MCP_TOKEN_FILE=.secrets/token\n");

    const config = loadConfig(
      {
        DRAFTS_MCP_ENV_FILE: envPath,
      },
      { cwd: tmpdir() },
    );

    expect(config.token).toBe("relative-file-token");
  });

  test("rejects token files that are group or world readable", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "drafts-bridge-"));
    const tokenPath = path.join(tempDir, "token");
    await writeFile(tokenPath, "file-token\n");
    await chmod(tokenPath, 0o644);

    expect(() =>
      loadConfig({
        DRAFTS_MCP_TOKEN_FILE: tokenPath,
      }),
    ).toThrow(/must not be group\/world readable/);
  });

  test("rejects a default token directory accessible to other users", async () => {
    const configHome = await mkdtemp(path.join(tmpdir(), "drafts-config-"));
    const tokenPath = defaultTokenFile({ XDG_CONFIG_HOME: configHome });
    await mkdir(path.dirname(tokenPath));
    await chmod(path.dirname(tokenPath), 0o755);
    await writeFile(tokenPath, "private-token\n", { mode: 0o600 });
    expect(() => loadConfig({ XDG_CONFIG_HOME: configHome })).toThrow(/private directory/);
  });
});

describe("upstream child process", () => {
  test("launches a stdio MCP child process", async () => {
    upstream = await connectUpstream(process.execPath, [fakeUpstreamPath]);

    expect(upstream.transport.pid).toEqual(expect.any(Number));
    const tools = await upstream.client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("drafts_get_current");
  });

  test("notifies when the stdio MCP child process closes", async () => {
    upstream = await connectUpstream(process.execPath, [fakeUpstreamPath]);

    const closed = new Promise<void>((resolve) => {
      upstream?.onClose(resolve);
    });
    await upstream.close();
    upstream = undefined;

    await expect(closed).resolves.toBeUndefined();
  });
});

describe("bridge server", () => {
  test("formats IPv4 and IPv6 listener addresses for advertised URLs", () => {
    expect(formatAddressForUrl("127.0.0.1")).toBe("127.0.0.1");
    expect(formatAddressForUrl("::1")).toBe("[::1]");
    expect(formatAddressForUrl("fd7a:115c:a1e0::1")).toBe("[fd7a:115c:a1e0::1]");
  });

  test("starts on the configured host and port", async () => {
    runtime = await startTestBridge();

    expect(runtime.url.hostname).toBe("127.0.0.1");
    expect(Number(runtime.url.port)).toBeGreaterThan(0);
  });

  test("rejects requests without valid bearer auth", async () => {
    runtime = await startTestBridge();

    const response = await fetch(runtime.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: {
            name: "smoke",
            version: "0.0.0",
          },
        },
      }),
    });

    expect(response.status).toBe(401);
  });

  test("does not trust a malformed Host header for request routing", async () => {
    runtime = await startTestBridge();

    const response = await fetch(new URL("/not-mcp", runtime.url), {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        host: "[",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });

    expect(response.status).toBe(404);
  });

  test("accepts valid bearer auth and exposes read-only tools only", async () => {
    runtime = await startTestBridge();
    const client = new Client({
      name: "bridge-smoke",
      version: "0.0.0",
    });
    const transport = new StreamableHTTPClientTransport(runtime.url, {
      requestInit: {
        headers: {
          authorization: "Bearer test-token",
        },
      },
    });

    await client.connect(transport);
    expect(client.getServerVersion()).toEqual({
      name: "drafts-mcp-bridge",
      version: BRIDGE_VERSION,
    });
    const tools = await client.listTools();
    await client.close();

    expect(tools.tools.map((tool) => tool.name)).toEqual(["drafts_get_current"]);
  });

  test("rejects mutating tool calls while read-only mode is enabled", async () => {
    runtime = await startTestBridge();
    const client = new Client({
      name: "bridge-smoke",
      version: "0.0.0",
    });
    const transport = new StreamableHTTPClientTransport(runtime.url, {
      requestInit: {
        headers: {
          authorization: "Bearer test-token",
        },
      },
    });

    await client.connect(transport);
    await expect(client.callTool({ name: "drafts_create_draft", arguments: {} })).rejects.toThrow(
      /not available while DRAFTS_MCP_READ_ONLY is enabled/,
    );
    await client.close();
  });

  test("verbose mode logs redacted request metadata", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    runtime = await startTestBridge({
      verbose: true,
    });

    const response = await fetch(runtime.url, {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-secret-value",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });

    expect(response.status).toBe(401);
    const logOutput = consoleError.mock.calls.map((call) => call.join(" ")).join("\n");
    consoleError.mockRestore();

    expect(logOutput).toContain("[request]");
    expect(logOutput).toContain('"method":"POST"');
    expect(logOutput).toContain('"path":"/mcp"');
    expect(logOutput).toContain('"statusCode":401');
    expect(logOutput).toContain('"authorized":false');
    expect(logOutput).toContain('"hasAuthorizationHeader":true');
    expect(logOutput).not.toContain("wrong-secret-value");
  });
});

async function startTestBridge(options: { verbose?: boolean } = {}): Promise<BridgeRuntime> {
  upstream = await connectUpstream(process.execPath, [fakeUpstreamPath]);
  return startBridge(
    {
      token: "test-token",
      host: "127.0.0.1",
      port: 0,
      readOnly: true,
      upstreamCommand: process.execPath,
      upstreamArgs: [fakeUpstreamPath],
      upstreamBinPath: fakeUpstreamPath,
      verbose: options.verbose ?? false,
    },
    upstream,
  );
}
