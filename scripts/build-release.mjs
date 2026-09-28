import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const releaseRoot = path.join(root, "release");
const installedOutput = path.join(releaseRoot, "drafts-mcp-bridge");
const previousOutput = path.join(releaseRoot, ".previous-drafts-mcp-bridge");
mkdirSync(releaseRoot, { recursive: true });
const lockDir = path.join(releaseRoot, ".build.lock");
try {
  mkdirSync(lockDir);
} catch {
  throw new Error(`Another release build is running, or ${lockDir} is stale.`);
}
try {
  // Restore a release left aside if an earlier build was interrupted during promotion.
  if (!existsSync(installedOutput) && existsSync(previousOutput)) {
    renameSync(previousOutput, installedOutput);
  }
  const stagingRoot = mkdtempSync(path.join(releaseRoot, ".build-"));
  const output = path.join(stagingRoot, "drafts-mcp-bridge");
  try {
    const upstreamPackage = require.resolve("@agiletortoise/drafts-mcp-server/package.json");
    const upstream = JSON.parse(readFileSync(upstreamPackage, "utf8"));
    const bridge = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

    // Build without runtime secrets; the archive is created before restoring .env.
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

    const hash = createHash("sha256").update(bridge.version);
    for (const filename of readdirSync(path.join(output, "dist"))
      .filter((name) => name.endsWith(".mjs"))
      .sort()) {
      hash.update(filename).update(readFileSync(path.join(output, "dist", filename)));
    }
    for (const directory of ["scripts", "launchd"]) {
      for (const filename of readdirSync(path.join(root, directory)).sort()) {
        const file = path.join(root, directory, filename);
        if (file === fileURLToPath(import.meta.url) || !statSync(file).isFile()) continue;
        hash.update(`${directory}/${filename}`).update(readFileSync(file));
      }
    }
    writeFileSync(
      path.join(output, "package.json"),
      `${JSON.stringify({ name: bridge.name, version: bridge.version, buildId: hash.digest("hex").slice(0, 12) }, null, 2)}\n`,
    );

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
      const license = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md"].find(
        (name) => existsSync(path.join(directory, name)),
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
    const archive = path.join(releaseRoot, "drafts-mcp-bridge.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", path.dirname(output), path.basename(output)]);
    if (existsSync(previousOutput)) rmSync(previousOutput, { recursive: true });
    if (existsSync(installedOutput)) renameSync(installedOutput, previousOutput);
    try {
      const envFile = path.join(previousOutput, ".env");
      if (existsSync(envFile)) {
        if (!lstatSync(envFile).isFile()) throw new Error("Release .env must be a regular file.");
        writeFileSync(path.join(output, ".env"), readFileSync(envFile), { mode: 0o600 });
      }
      renameSync(output, installedOutput);
    } catch (error) {
      if (existsSync(previousOutput)) renameSync(previousOutput, installedOutput);
      throw error;
    }
    console.error(`Built ${archive} (Node.js 24+ required; no pnpm or node_modules at runtime)`);
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
} finally {
  rmdirSync(lockDir);
}
