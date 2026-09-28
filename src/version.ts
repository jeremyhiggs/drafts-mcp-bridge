import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
  buildId?: string;
};

export const BRIDGE_VERSION = manifest.buildId
  ? `${manifest.version}+${manifest.buildId}`
  : manifest.version;
