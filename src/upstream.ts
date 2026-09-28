import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { BRIDGE_VERSION } from "./version.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const require = createRequire(import.meta.url);

type PackageJson = {
  name?: string;
  bin?: string | Record<string, string>;
};

export type ResolvedUpstream = {
  command: string;
  args: string[];
  binPath: string;
};

export type UpstreamConnection = {
  client: Client;
  transport: StdioClientTransport;
  onClose: (listener: () => void) => void;
  close: () => Promise<void>;
};

export function resolveDefaultUpstream(): ResolvedUpstream {
  const bundledBin = new URL("./upstream.mjs", import.meta.url);
  if (existsSync(bundledBin)) {
    const binPath = fileURLToPath(bundledBin);
    return { command: process.execPath, args: [binPath], binPath };
  }

  const packageJsonPath = require.resolve("@agiletortoise/drafts-mcp-server/package.json");
  const packageJson = require(packageJsonPath) as PackageJson;
  const packageDir = path.dirname(packageJsonPath);
  const binRelative = resolveBinRelativePath(packageJson);
  const binPath = path.resolve(packageDir, binRelative);

  return {
    command: process.execPath,
    args: [binPath],
    binPath,
  };
}

export async function connectUpstream(
  command: string,
  args: string[],
): Promise<UpstreamConnection> {
  const transport = new StdioClientTransport({
    command,
    args,
    stderr: "ignore",
  });
  const client = new Client(
    {
      name: "drafts-mcp-bridge-upstream-client",
      version: BRIDGE_VERSION,
    },
    {
      capabilities: {},
    },
  );

  await client.connect(transport);

  return {
    client,
    transport,
    onClose: (listener: () => void) => {
      transport.onclose = listener;
    },
    close: async () => {
      await client.close();
    },
  };
}

function resolveBinRelativePath(packageJson: PackageJson): string {
  if (typeof packageJson.bin === "string") {
    return packageJson.bin;
  }

  const packageBin = packageJson.bin?.["drafts-mcp-server"];
  if (!packageBin) {
    throw new Error("@agiletortoise/drafts-mcp-server does not declare a drafts-mcp-server bin.");
  }

  return packageBin;
}
