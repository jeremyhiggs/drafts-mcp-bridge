import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const fakeUpstreamPath = path.join(__dirname, "fixtures", "fake-upstream.mjs");
const execute = promisify(execFile);

let bridgeProcess: ChildProcessWithoutNullStreams | undefined;

afterEach(async () => {
  if (bridgeProcess) {
    await stopProcess(bridgeProcess);
    bridgeProcess = undefined;
  }
});

describe("standalone release", () => {
  beforeAll(async () => {
    await execute("pnpm", ["build:release"], { cwd: repoRoot });
  }, 30_000);

  test("rebuild preserves local config without packing it into the archive", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "drafts release build "));
    for (const name of ["package.json", "README.md", ".env.example", "src", "scripts", "launchd"]) {
      await cp(path.join(repoRoot, name), path.join(scratch, name), { recursive: true });
    }
    await symlink(path.join(repoRoot, "node_modules"), path.join(scratch, "node_modules"), "dir");
    const releaseRoot = path.join(scratch, "release", "drafts-mcp-bridge");
    await mkdir(releaseRoot, { recursive: true });
    await writeFile(path.join(releaseRoot, ".env"), "DRAFTS_MCP_READ_ONLY=false\n", {
      mode: 0o600,
    });
    await writeFile(path.join(releaseRoot, "private.txt"), "not for the archive\n");

    await execute(process.execPath, ["scripts/build-release.mjs"], { cwd: scratch });
    await execute(process.execPath, ["scripts/build-release.mjs"], { cwd: scratch });

    expect(await readFile(path.join(releaseRoot, ".env"), "utf8")).toBe(
      "DRAFTS_MCP_READ_ONLY=false\n",
    );
    expect((await stat(path.join(releaseRoot, ".env"))).mode & 0o777).toBe(0o600);
    const archive = await execute("tar", [
      "-tzf",
      path.join(scratch, "release", "drafts-mcp-bridge.tar.gz"),
    ]);
    expect(archive.stdout.split("\n")).not.toContain("drafts-mcp-bridge/.env");
    expect(archive.stdout.split("\n")).not.toContain("drafts-mcp-bridge/private.txt");
  }, 30_000);

  test.each(["run-server.sh", "run-tailscale.sh"])(
    "%s runs with bundled upstream and no node_modules or pnpm",
    async (scriptName) => {
      const tempDir = await mkdtemp(path.join(tmpdir(), "drafts release "));
      await execute("tar", [
        "-xzf",
        path.join(repoRoot, "release", "drafts-mcp-bridge.tar.gz"),
        "-C",
        tempDir,
      ]);
      const releaseRoot = path.join(tempDir, "drafts-mcp-bridge");
      await expect(access(path.join(releaseRoot, "node_modules"))).rejects.toThrow();
      const releaseManifest = JSON.parse(
        await readFile(path.join(releaseRoot, "package.json"), "utf8"),
      ) as { version: string; buildId: string };
      const releaseVersion = `${releaseManifest.version}+${releaseManifest.buildId}`;
      expect(releaseManifest.buildId).toMatch(/^[a-f0-9]{12}$/);

      const binDir = path.join(tempDir, "bin");
      await mkdir(binDir);
      await writeFile(path.join(binDir, "pnpm"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
      await writeFile(
        path.join(binDir, "osascript"),
        '#!/bin/sh\ncat > /dev/null\nprintf "Release workspace\\n"\n',
        { mode: 0o755 },
      );
      const tailscaleLog = path.join(tempDir, "tailscale.log");
      await writeFile(
        path.join(binDir, "tailscale"),
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TAILSCALE_TEST_LOG"\nif [ "$*" = "serve status --json" ]; then printf "{}\\n"; fi\n',
        { mode: 0o755 },
      );
      const env = {
        ...withoutDraftsEnv(process.env),
        HOME: path.join(tempDir, "home"),
        PATH: `${binDir}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
        TAILSCALE_TEST_LOG: tailscaleLog,
        LAUNCHCTL_TEST_STATE: path.join(tempDir, "launchctl-state"),
        XDG_CONFIG_HOME: path.join(tempDir, "config & # <bridge>"),
      };
      const versionResult = await execute(
        path.join(releaseRoot, "scripts", scriptName),
        ["--version"],
        { cwd: tempDir, env },
      );
      expect(versionResult.stdout.trim()).toBe(releaseVersion);
      await execute(path.join(releaseRoot, "scripts", "generate-token.sh"), [], {
        cwd: tempDir,
        env,
      });
      const tokenPath = path.join(env.XDG_CONFIG_HOME, "drafts-mcp-bridge", "token");
      const token = (await readFile(tokenPath, "utf8")).trim();
      expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
      expect((await stat(path.dirname(tokenPath))).mode & 0o777).toBe(0o700);
      await writeFile(
        path.join(releaseRoot, ".env"),
        `XDG_CONFIG_HOME=${JSON.stringify(env.XDG_CONFIG_HOME)}\nDRAFTS_MCP_PORT=0\nDRAFTS_MCP_VERBOSE=true\n`,
      );

      bridgeProcess = spawn(path.join(releaseRoot, "scripts", scriptName), [], {
        cwd: tempDir,
        env,
      });
      const bridgeUrl = await waitForBridgeUrl(bridgeProcess);
      expect((await fetch(bridgeUrl)).status).toBe(401);
      const client = new Client({ name: "standalone-test-client", version: "0.0.0" });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(bridgeUrl, {
            requestInit: { headers: { authorization: `Bearer ${token}` } },
          }),
        );
        expect(client.getServerVersion()).toEqual({
          name: "drafts-mcp-bridge",
          version: releaseVersion,
        });
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toContain("drafts_get_current");
        expect(tools.tools.map((tool) => tool.name)).not.toContain("drafts_create_draft");
        const result = await client.callTool({ name: "drafts_list_workspaces", arguments: {} });
        expect(result.isError).not.toBe(true);
        expect(result.content).toEqual([
          { type: "text", text: JSON.stringify([{ name: "Release workspace" }], null, 2) },
        ]);
      } finally {
        await client.close();
      }
      await stopProcess(bridgeProcess);
      expect(bridgeProcess.exitCode).toBe(0);
      bridgeProcess = undefined;
      if (scriptName === "run-tailscale.sh") {
        expect(await readFile(tailscaleLog, "utf8")).toContain(
          `serve --bg --set-path /drafts-mcp ${bridgeUrl.href}`,
        );
        await writeFile(
          path.join(binDir, "launchctl"),
          '#!/bin/sh\ncase "$1" in\n  print) if [ -f "$LAUNCHCTL_TEST_STATE" ]; then printf "state = running\\n"; else exit 1; fi ;;\n  bootout) rm -f "$LAUNCHCTL_TEST_STATE" ;;\n  bootstrap) touch "$LAUNCHCTL_TEST_STATE" ;;\nesac\n',
          { mode: 0o755 },
        );
        await writeFile(path.join(binDir, "plutil"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        const releasesDir = path.join(
          env.HOME,
          "Library",
          "Application Support",
          "drafts-mcp-bridge",
          "releases",
        );
        await mkdir(path.join(releasesDir, "old-release"), { recursive: true });
        await execute(path.join(repoRoot, "scripts", "install-launch-agent.sh"), [], { env });
        const plistPath = path.join(
          env.HOME,
          "Library",
          "LaunchAgents",
          "local.drafts-mcp-bridge.plist",
        );
        const firstRelease = await readdir(releasesDir);
        expect(firstRelease).toHaveLength(1);
        expect(firstRelease[0].startsWith(`${releaseVersion}.`)).toBe(true);
        const firstInstalledRoot = path.join(releasesDir, firstRelease[0]);
        expect(await readFile(plistPath, "utf8")).toContain(
          `<string>${firstInstalledRoot}</string>`,
        );
        await expect(access(path.join(firstInstalledRoot, "node_modules"))).rejects.toThrow();
        await expect(access(path.join(firstInstalledRoot, ".env"))).rejects.toThrow();
        const installEnv: NodeJS.ProcessEnv = { ...env };
        const configFile = path.join(env.XDG_CONFIG_HOME, "drafts-mcp-bridge", "config.env");
        await writeFile(configFile, "DRAFTS_MCP_PORT=0\nDRAFTS_MCP_VERBOSE=true\n", {
          mode: 0o600,
        });
        await execute(path.join(releaseRoot, "scripts", "install-launch-agent.sh"), [], {
          env: installEnv,
        });
        const plist = await readFile(plistPath, "utf8");
        const secondRelease = await readdir(releasesDir);
        expect(secondRelease).toHaveLength(1);
        expect(secondRelease[0]).not.toBe(firstRelease[0]);
        const installedRoot = path.join(releasesDir, secondRelease[0]);
        expect(plist).toContain(
          `<string>${installedRoot.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</string>`,
        );
        await expect(access(path.join(installedRoot, ".env"))).rejects.toThrow();
        expect((await stat(configFile)).mode & 0o777).toBe(0o600);
        expect(plist).toContain(
          `<string>${env.XDG_CONFIG_HOME.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</string>`,
        );
        expect(plist).not.toContain(token);
        await chmod(tokenPath, 0o644);
        await expect(
          execute(path.join(releaseRoot, "scripts", "install-launch-agent.sh"), [], {
            env: installEnv,
          }),
        ).rejects.toThrow(/must not be group\/world readable/);
        expect(await readdir(releasesDir)).toEqual(secondRelease);
        const lockDir = path.join(path.dirname(releasesDir), ".install.lock");
        await mkdir(lockDir);
        await expect(
          execute(path.join(releaseRoot, "scripts", "install-launch-agent.sh"), [], {
            env: installEnv,
          }),
        ).rejects.toThrow(/Another install is running/);
        expect(await readdir(releasesDir)).toEqual(secondRelease);
      }
    },
    30_000,
  );
});

describe("packaged bridge integration", () => {
  test("reports the source version without requiring a token", async () => {
    const manifest = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
      version: string;
    };
    const { stdout } = await execute("pnpm", ["start", "--version"], {
      cwd: repoRoot,
      env: { ...withoutDraftsEnv(process.env), DRAFTS_MCP_TOKEN: "" },
    });
    expect(stdout.trim()).toBe(manifest.version);
  }, 30_000);

  test("starts via pnpm start and serves MCP over authenticated HTTP", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "drafts-bridge-integration-"));
    const tokenPath = path.join(tempDir, ".secrets", "token");
    const envPath = path.join(tempDir, ".env");
    await mkdir(path.dirname(tokenPath));
    await writeFile(tokenPath, "integration-token\n", { mode: 0o600 });
    await writeFile(
      envPath,
      [
        `DRAFTS_MCP_TOKEN_FILE=${tokenPath}`,
        "DRAFTS_MCP_HOST=127.0.0.1",
        "DRAFTS_MCP_PORT=0",
        "DRAFTS_MCP_READ_ONLY=true",
        `DRAFTS_MCP_UPSTREAM_COMMAND=${process.execPath}`,
        `DRAFTS_MCP_UPSTREAM_ARGS=${JSON.stringify([fakeUpstreamPath])}`,
      ].join("\n"),
    );

    bridgeProcess = spawn("pnpm", ["start"], {
      cwd: repoRoot,
      env: {
        ...withoutDraftsEnv(process.env),
        DRAFTS_MCP_ENV_FILE: envPath,
      },
    });

    const bridgeUrl = await waitForBridgeUrl(bridgeProcess);
    const client = new Client({
      name: "integration-test-client",
      version: "0.0.0",
    });
    const transport = new StreamableHTTPClientTransport(bridgeUrl, {
      requestInit: {
        headers: {
          authorization: "Bearer integration-token",
        },
      },
    });

    await client.connect(transport);
    const tools = await client.listTools();
    await client.close();

    expect(tools.tools.map((tool) => tool.name)).toEqual(["drafts_get_current"]);
  }, 30_000);
});

function withoutDraftsEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("DRAFTS_MCP_")));
}

async function waitForBridgeUrl(child: ChildProcessWithoutNullStreams): Promise<URL> {
  let output = "";

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for bridge startup. Output:\n${output}`));
    }, 20_000);

    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const match = output.match(/drafts-mcp-bridge listening on (http:\/\/\S+)/);
      if (match) {
        cleanup();
        resolve(new URL(match[1]));
      }
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Bridge exited before startup. code=${String(code)} signal=${String(signal)}\n${output}`,
        ),
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
  });
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
