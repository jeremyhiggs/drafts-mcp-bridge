import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const output = path.join(root, "release", "drafts-mcp-bridge");
const upstreamPackage = require.resolve("@agiletortoise/drafts-mcp-server/package.json");
const upstream = JSON.parse(readFileSync(upstreamPackage, "utf8"));

// This directory contains generated release files only, never runtime secrets.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: {
    index: "src/index.ts",
    config: "src/config.ts",
    "tailscale-start": "src/tailscale-start.ts",
    "generate-token": "src/generate-token.ts",
    upstream: path.resolve(path.dirname(upstreamPackage), upstream.bin["drafts-mcp-server"]),
  },
  outdir: path.join(output, "dist"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  splitting: true,
  platform: "node",
  target: "node24",
  format: "esm",
  banner: {
    js: 'import { createRequire as __bundleCreateRequire } from "node:module"; const require = __bundleCreateRequire(import.meta.url);',
  },
  legalComments: "eof",
  metafile: true,
});

// Keep licenses for every dependency whose code is included in the bundles.
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.startsWith("node_modules/")) continue;
  let directory = path.dirname(path.resolve(root, input));
  while (directory !== root) {
    const manifest = path.join(directory, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name) break;
    directory = path.dirname(directory);
  }
  if (directory === root) throw new Error(`Cannot find dependency package for ${input}`);
  packages.add(directory);
}
const notices = [...packages].sort().map((directory) => {
  const metadata = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  const license = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md"].find((name) =>
    existsSync(path.join(directory, name)),
  );
  if (!license) throw new Error(`Missing bundled dependency license: ${metadata.name}`);
  return `${metadata.name}@${metadata.version}\n${readFileSync(path.join(directory, license), "utf8")}`;
});
writeFileSync(path.join(output, "THIRD_PARTY_NOTICES.txt"), notices.join("\n\n"));
for (const name of ["scripts", "launchd", "README.md", ".env.example"]) {
  cpSync(path.join(root, name), path.join(output, name), {
    recursive: true,
    filter: (source) => source !== fileURLToPath(import.meta.url),
  });
}
const archive = path.join(root, "release", "drafts-mcp-bridge.tar.gz");
execFileSync("tar", ["-czf", archive, "-C", path.dirname(output), path.basename(output)]);
console.error(`Built ${archive} (Node.js 24+ required; no pnpm or node_modules at runtime)`);
