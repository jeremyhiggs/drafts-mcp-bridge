import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

describe("runner scripts", () => {
  test.each(["run-server.sh", "run-tailscale.sh", "generate-token.sh", "drafts-mcp-bridge.sh"])(
    "%s rebuilds before executing compiled output",
    async (scriptName) => {
      const script = await readFile(path.join(repoRoot, "scripts", scriptName), "utf8");

      if (scriptName === "run-tailscale.sh") {
        expect(script).toContain('DRAFTS_MCP_BRIDGE_ROOT="$ROOT_DIR"');
        expect(script).toContain("scripts/drafts-mcp-bridge.sh");
      } else if (scriptName === "drafts-mcp-bridge.sh") {
        expect(script).toContain('pnpm --dir "$ROOT_DIR" run build');
        expect(script).toContain('node "$ROOT_DIR/dist/tailscale-start.js"');
      } else {
        expect(script).toContain("pnpm run build");
      }
      expect(script).not.toMatch(/if \[ ! -f dist\//);
    },
  );

  test("launch agent log script tails stdout and stderr logs", async () => {
    const script = await readFile(
      path.join(repoRoot, "scripts", "tail-launch-agent-logs.sh"),
      "utf8",
    );

    expect(script).toContain("$HOME/Library/Logs/drafts-mcp-bridge");
    expect(script).toContain("out.log");
    expect(script).toContain("err.log");
    expect(script).toContain("tail -n 200 -f");
  });

  test("launch agent template uses the local service shape", async () => {
    const template = await readFile(
      path.join(repoRoot, "launchd", "local.drafts-mcp-bridge.plist.template"),
      "utf8",
    );

    expect(template).toContain("<string>__LABEL__</string>");
    expect(template).toContain("<string>__WORKING_DIRECTORY__</string>");
    expect(template).toContain("<key>DRAFTS_MCP_BRIDGE_ROOT</key>");
    expect(template).toContain("<string>__REPO_ROOT__</string>");
    expect(template).toContain("<string>__LAUNCHER__</string>");
    expect(template).not.toContain("<string>__PNPM__</string>");
    expect(template).not.toContain("<string>start:tailscale</string>");
    expect(template).toContain("<key>RunAtLoad</key>");
    expect(template).toContain("<key>KeepAlive</key>");
  });

  test("launch agent installer renders and manages a user LaunchAgent", async () => {
    const script = await readFile(
      path.join(repoRoot, "scripts", "install-launch-agent.sh"),
      "utf8",
    );

    expect(script).toContain('LABEL="local.drafts-mcp-bridge"');
    expect(script).toContain('ROOT_DIR="$ROOT_DIR/release/drafts-mcp-bridge"');
    expect(script).toContain("Run pnpm release first");
    expect(script).toContain('SERVICE_DIR="$HOME/Library/Application Support/drafts-mcp-bridge"');
    expect(script).toContain('SOURCE_LAUNCHER_PATH="$ROOT_DIR/scripts/drafts-mcp-bridge.sh"');
    expect(script).toContain('LAUNCHER_PATH="$SERVICE_DIR/drafts-mcp-bridge.sh"');
    expect(script).toContain('cp "$SOURCE_LAUNCHER_PATH" "$LAUNCHER_PATH"');
    expect(script).toContain("$HOME/Library/LaunchAgents/$LABEL.plist");
    expect(script).toContain("wait_for_service_removal");
    expect(script).toContain('launchctl print "$GUI_DOMAIN/$LABEL"');
    expect(script).toContain('if [ "$attempts" -ge 10 ]');
    expect(script).toContain("bootstrap_launch_agent");
    expect(script).toContain('launchctl bootstrap "$GUI_DOMAIN" "$PLIST"');
    expect(script).toContain('if [ "$attempts" -ge 5 ]');
    expect(script).toContain('launchctl enable "$GUI_DOMAIN/$LABEL"');
    expect(script).toContain('launchctl kickstart -k "$GUI_DOMAIN/$LABEL"');
    expect(script).toContain("Node.js 24 or newer is required.");
  });

  test("package metadata enforces Node.js 24 or newer", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
      engines?: { node?: string };
    };
    const npmrc = await readFile(path.join(repoRoot, ".npmrc"), "utf8");

    expect(packageJson.engines?.node).toBe(">=24.0.0");
    expect(npmrc).toContain("engine-strict=true");
  });
});
