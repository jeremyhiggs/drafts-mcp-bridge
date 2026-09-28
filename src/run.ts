import { loadConfig } from "./config.js";
import { parseRuntimeArgs } from "./runtime-args.js";
import { startBridge, type BridgeRuntime } from "./server.js";
import {
  checkTailscaleServePathAvailable,
  registerTailscaleServe,
  TAILSCALE_SERVE_PATH,
} from "./tailscale.js";
import { connectUpstream } from "./upstream.js";
import { BRIDGE_VERSION } from "./version.js";

export async function runBridge(args: string[], tailscale = false): Promise<void> {
  if (args.length === 1 && args[0] === "--version") {
    console.log(BRIDGE_VERSION);
    return;
  }

  const config = loadConfig(process.env, parseRuntimeArgs(args));
  if (tailscale && config.host !== "127.0.0.1" && config.host !== "localhost") {
    throw new Error("Tailscale Serve mode requires DRAFTS_MCP_HOST=127.0.0.1.");
  }

  const upstream = await connectUpstream(config.upstreamCommand, config.upstreamArgs);
  let runtime: BridgeRuntime | undefined;
  try {
    runtime = await startBridge(config, upstream);
    if (tailscale) {
      checkTailscaleServePathAvailable(runtime);
      registerTailscaleServe(runtime);
      console.error(`tailscale serve path=${TAILSCALE_SERVE_PATH}`);
    }
  } catch (error) {
    await (runtime ? runtime.close() : upstream.close());
    throw error;
  }

  console.error(
    `drafts-mcp-bridge listening on ${runtime.url.href} version=${BRIDGE_VERSION} readOnly=${String(config.readOnly)} verbose=${String(config.verbose)} upstreamBin=${config.upstreamBinPath}`,
  );

  const bridge = runtime;
  let shuttingDown = false;
  const shutdown = async (exitCode: number) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      await bridge.close();
      process.exit(exitCode);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  };

  upstream.onClose(() => {
    if (!shuttingDown) {
      console.error("upstream stdio MCP process exited; shutting down bridge");
      void shutdown(1);
    }
  });
  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));
}
