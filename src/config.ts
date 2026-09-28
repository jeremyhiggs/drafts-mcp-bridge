import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parse as parseDotenv } from "dotenv";
import { resolveDefaultUpstream } from "./upstream.js";

export function defaultTokenFile(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(env.HOME || homedir(), ".config");
  if (!path.isAbsolute(configHome)) {
    throw new Error("XDG_CONFIG_HOME must be an absolute path.");
  }
  return path.join(configHome, "drafts-mcp-bridge", "token");
}

export type BridgeConfig = {
  token: string;
  host: string;
  port: number;
  readOnly: boolean;
  upstreamCommand: string;
  upstreamArgs: string[];
  upstreamBinPath: string;
  verbose: boolean;
  tailscaleServe: boolean;
};

export type ConfigLoadOptions = {
  cwd?: string;
  verbose?: boolean;
};

type EnvSources = {
  env: NodeJS.ProcessEnv;
  tokenFileBaseDir: string;
};

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: ConfigLoadOptions = {},
): BridgeConfig {
  const cwd = options.cwd ?? process.cwd();
  const sources = loadEnvSources(env, cwd);
  const effectiveEnv = sources.env;
  const token = resolveToken(effectiveEnv, sources.tokenFileBaseDir);
  if (!token) {
    throw new Error(
      "A bearer token is required. Run scripts/generate-token.sh or set DRAFTS_MCP_TOKEN / DRAFTS_MCP_TOKEN_FILE.",
    );
  }

  const resolvedUpstream = resolveDefaultUpstream();
  const upstreamCommand =
    effectiveEnv.DRAFTS_MCP_UPSTREAM_COMMAND?.trim() || resolvedUpstream.command;
  const upstreamArgs = effectiveEnv.DRAFTS_MCP_UPSTREAM_ARGS
    ? parseArgsEnv(effectiveEnv.DRAFTS_MCP_UPSTREAM_ARGS)
    : effectiveEnv.DRAFTS_MCP_UPSTREAM_COMMAND !== undefined
      ? []
      : resolvedUpstream.args;

  return {
    token,
    host: effectiveEnv.DRAFTS_MCP_HOST?.trim() || "127.0.0.1",
    port: parsePort(effectiveEnv.DRAFTS_MCP_PORT),
    readOnly: parseReadOnly(effectiveEnv.DRAFTS_MCP_READ_ONLY),
    upstreamCommand,
    upstreamArgs,
    upstreamBinPath: resolvedUpstream.binPath,
    verbose: options.verbose ?? parseBoolean(effectiveEnv.DRAFTS_MCP_VERBOSE, false),
    tailscaleServe: parseBoolean(effectiveEnv.DRAFTS_MCP_TAILSCALE_SERVE, false),
  };
}

export function loadEffectiveEnv(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): NodeJS.ProcessEnv {
  return loadEnvSources(env, cwd).env;
}

function loadEnvSources(env: NodeJS.ProcessEnv, cwd: string): EnvSources {
  const configuredEnvFile = env.DRAFTS_MCP_ENV_FILE?.trim();
  const envFile = configuredEnvFile || path.join(cwd, ".env");
  const fileEnv = loadEnvFile(envFile, configuredEnvFile !== undefined);
  const configFile = path.join(
    path.dirname(defaultTokenFile({ ...fileEnv, ...env })),
    "config.env",
  );
  if (existsSync(configFile)) {
    const directory = lstatSync(path.dirname(configFile));
    const file = lstatSync(configFile);
    if (
      !directory.isDirectory() ||
      (directory.mode & 0o077) !== 0 ||
      !file.isFile() ||
      (file.mode & 0o077) !== 0
    ) {
      throw new Error(
        "The config directory must be private (0700) and config.env must be a private regular file (0600).",
      );
    }
  }
  const configEnv = loadEnvFile(configFile, false);

  return {
    env: {
      ...configEnv,
      ...fileEnv,
      ...env,
    },
    tokenFileBaseDir:
      !env.DRAFTS_MCP_TOKEN_FILE &&
      !fileEnv.DRAFTS_MCP_TOKEN_FILE &&
      configEnv.DRAFTS_MCP_TOKEN_FILE
        ? path.dirname(configFile)
        : existsSync(envFile)
          ? path.dirname(path.resolve(envFile))
          : cwd,
  };
}

function loadEnvFile(filePath: string, required: boolean): Record<string, string> {
  if (!existsSync(filePath)) {
    if (required) {
      throw new Error(`DRAFTS_MCP_ENV_FILE does not exist: ${filePath}`);
    }
    return {};
  }

  return parseDotenv(readFileSync(filePath));
}

function resolveToken(env: NodeJS.ProcessEnv, tokenFileBaseDir: string): string | undefined {
  const directToken = env.DRAFTS_MCP_TOKEN?.trim();
  if (directToken) {
    return directToken;
  }

  const tokenFile = env.DRAFTS_MCP_TOKEN_FILE?.trim();
  if (!tokenFile) {
    const defaultTokenFilePath = defaultTokenFile(env);
    if (!existsSync(defaultTokenFilePath)) {
      return undefined;
    }

    const directory = lstatSync(path.dirname(defaultTokenFilePath));
    if (!directory.isDirectory() || (directory.mode & 0o077) !== 0) {
      throw new Error("The default token directory must be a private directory (0700).");
    }
    return readTokenFile(defaultTokenFilePath);
  }

  const tokenFilePath = path.isAbsolute(tokenFile)
    ? tokenFile
    : path.resolve(tokenFileBaseDir, tokenFile);
  return readTokenFile(tokenFilePath);
}

function readTokenFile(tokenFilePath: string): string | undefined {
  assertPrivateFile(tokenFilePath);
  const token = readFileSync(tokenFilePath, "utf8").trim();
  return token.length > 0 ? token : undefined;
}

function assertPrivateFile(filePath: string): void {
  const stat = lstatSync(filePath);

  if (!stat.isFile()) {
    throw new Error(`DRAFTS_MCP_TOKEN_FILE must point to a regular file: ${filePath}`);
  }

  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`DRAFTS_MCP_TOKEN_FILE must not be group/world readable: ${filePath}`);
  }
}

export function parseReadOnly(value: string | undefined): boolean {
  return parseBoolean(value, true, "DRAFTS_MCP_READ_ONLY");
}

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
  name: string = "boolean value",
): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  switch (value.trim().toLowerCase()) {
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      throw new Error(`${name} must be true or false.`);
  }
}

export function parseArgsEnv(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      throw new Error("Invalid argument array");
    }
    return parsed;
  } catch {
    throw new Error("DRAFTS_MCP_UPSTREAM_ARGS must be a JSON array of strings.");
  }
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 3060;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("DRAFTS_MCP_PORT must be an integer between 0 and 65535.");
  }

  return port;
}
