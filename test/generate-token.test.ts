import { chmod, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { defaultTokenFile } from "../src/config.js";
import { generateToken, parseArgs } from "../src/generate-token.js";

describe("token generation", () => {
  test("uses HOME when XDG_CONFIG_HOME is unset", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "drafts-home-"));
    const result = generateToken({ env: { HOME: home } });
    expect(result.tokenFilePath).toBe(path.join(home, ".config", "drafts-mcp-bridge", "token"));
  });

  test("rejects a relative XDG_CONFIG_HOME", () => {
    expect(() => generateToken({ env: { XDG_CONFIG_HOME: "relative" } })).toThrow(/absolute/);
  });

  test("refuses to write through a symbolic link for the token directory", async () => {
    const configHome = await mkdtemp(path.join(tmpdir(), "drafts-config-"));
    const target = await mkdtemp(path.join(tmpdir(), "drafts-target-"));
    await symlink(target, path.join(configHome, "drafts-mcp-bridge"));
    expect(() => generateToken({ env: { XDG_CONFIG_HOME: configHome } })).toThrow(/symbolic link/);
    expect((await stat(target)).mode & 0o777).toBe(0o700);
  });

  test("writes a private token to the default server token file", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "drafts-token-"));

    const result = generateToken({ env: { XDG_CONFIG_HOME: tempDir } });
    const tokenFilePath = defaultTokenFile({ XDG_CONFIG_HOME: tempDir });
    const token = await readFile(tokenFilePath, "utf8");
    const tokenStat = await stat(tokenFilePath);
    const tokenDirStat = await stat(path.dirname(tokenFilePath));

    expect(result.tokenFilePath).toBe(tokenFilePath);
    expect(result.overwritten).toBe(false);
    expect(token.trim()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenStat.mode & 0o777).toBe(0o600);
    expect(tokenDirStat.mode & 0o777).toBe(0o700);
  });

  test("refuses to overwrite an existing token without force", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "drafts-token-"));
    generateToken({ env: { XDG_CONFIG_HOME: tempDir } });

    expect(() => generateToken({ env: { XDG_CONFIG_HOME: tempDir } })).toThrow(/already exists/);
  });

  test("rotates an existing token when force is enabled", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "drafts-token-"));
    generateToken({ env: { XDG_CONFIG_HOME: tempDir } });
    const firstToken = await readFile(defaultTokenFile({ XDG_CONFIG_HOME: tempDir }), "utf8");

    const result = generateToken({ env: { XDG_CONFIG_HOME: tempDir }, force: true });
    const secondToken = await readFile(defaultTokenFile({ XDG_CONFIG_HOME: tempDir }), "utf8");

    expect(result.overwritten).toBe(true);
    expect(secondToken).not.toBe(firstToken);
  });

  test("tightens permissions when rotating an existing token", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "drafts-token-"));
    const tokenFilePath = defaultTokenFile({ XDG_CONFIG_HOME: tempDir });
    await mkdir(path.dirname(tokenFilePath), { recursive: true });
    generateToken({ env: { XDG_CONFIG_HOME: tempDir } });
    await chmod(path.dirname(tokenFilePath), 0o755);
    await chmod(tokenFilePath, 0o644);

    generateToken({ env: { XDG_CONFIG_HOME: tempDir }, force: true });
    const tokenDirStat = await stat(path.dirname(tokenFilePath));
    const tokenStat = await stat(tokenFilePath);

    expect(tokenDirStat.mode & 0o777).toBe(0o700);
    expect(tokenStat.mode & 0o777).toBe(0o600);
  });

  test("refuses to follow a symbolic link during forced rotation", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "drafts-token-"));
    const tokenFilePath = defaultTokenFile({ XDG_CONFIG_HOME: tempDir });
    const targetPath = path.join(tempDir, "unrelated-file");
    await mkdir(path.dirname(tokenFilePath), { recursive: true });
    await writeFile(targetPath, "do not replace\n");
    await symlink(targetPath, tokenFilePath);

    expect(() => generateToken({ env: { XDG_CONFIG_HOME: tempDir }, force: true })).toThrow(
      /symbolic link/,
    );
    await expect(readFile(targetPath, "utf8")).resolves.toBe("do not replace\n");
  });

  test("parses the optional force flag", () => {
    expect(parseArgs([])).toEqual({});
    expect(parseArgs(["--force"])).toEqual({ force: true });
    expect(() => parseArgs(["--unknown"])).toThrow(/Usage:/);
  });
});
