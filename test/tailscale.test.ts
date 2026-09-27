import { describe, expect, test } from "vitest";
import type { BridgeRuntime } from "../src/server.js";
import {
  assertTailscalePathAvailable,
  buildTailscaleServeArgs,
  TAILSCALE_SERVE_PATH,
} from "../src/tailscale.js";

describe("tailscale serve integration", () => {
  test("builds a persistent background serve command for the fixed Drafts path", () => {
    const runtime = {
      url: new URL("http://127.0.0.1:3060/mcp"),
    } as BridgeRuntime;

    expect(buildTailscaleServeArgs(runtime)).toEqual([
      "serve",
      "--bg",
      "--set-path",
      TAILSCALE_SERVE_PATH,
      "http://127.0.0.1:3060/mcp",
    ]);
  });

  test("allows existing serve config on unrelated paths", () => {
    const status = JSON.stringify({
      Web: {
        "example.tailnet.ts.net:443": {
          Handlers: {
            "/grafana": {
              Proxy: "http://127.0.0.1:3000",
            },
          },
        },
      },
    });

    expect(() => assertTailscalePathAvailable(status)).not.toThrow();
  });

  test("allows the expected drafts-mcp route on restart", () => {
    const status = JSON.stringify({
      Web: {
        "example.tailnet.ts.net:443": {
          Handlers: {
            "/drafts-mcp": {
              Proxy: "http://127.0.0.1:3060/mcp",
            },
          },
        },
      },
    });

    expect(() =>
      assertTailscalePathAvailable(status, TAILSCALE_SERVE_PATH, "http://127.0.0.1:3060/mcp"),
    ).not.toThrow();
  });

  test("rejects a drafts-mcp route pointing to another target", () => {
    const status = JSON.stringify({
      Web: {
        "example.tailnet.ts.net:443": {
          Handlers: {
            "/drafts-mcp": {
              Proxy: "http://127.0.0.1:9999/mcp",
            },
          },
        },
      },
    });

    expect(() =>
      assertTailscalePathAvailable(status, TAILSCALE_SERVE_PATH, "http://127.0.0.1:3060/mcp"),
    ).toThrow(/path \/drafts-mcp is already configured for a different target/);
  });
});
