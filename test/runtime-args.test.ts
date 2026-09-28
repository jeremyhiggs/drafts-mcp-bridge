import { describe, expect, test } from "vitest";
import { parseRuntimeArgs } from "../src/runtime-args.js";
import { loadConfig, parseArgsEnv } from "../src/config.js";

describe("runtime args", () => {
  test("parses verbose flags", () => {
    expect(parseRuntimeArgs([])).toEqual({ verbose: undefined });
    expect(parseRuntimeArgs(["--verbose"])).toEqual({ verbose: true });
    expect(parseRuntimeArgs(["-v"])).toEqual({ verbose: true });
  });

  test("preserves the verbose environment setting when no flag is supplied", () => {
    expect(
      loadConfig(
        { DRAFTS_MCP_TOKEN: "test-token", DRAFTS_MCP_VERBOSE: "true" },
        parseRuntimeArgs([]),
      ).verbose,
    ).toBe(true);
  });

  test("accepts JSON argument arrays, including empty strings, and rejects other shapes", () => {
    expect(parseArgsEnv('["", "two words", "a\\\\b"]')).toEqual(["", "two words", "a\\b"]);
    expect(parseArgsEnv(undefined)).toEqual([]);
    expect(parseArgsEnv(" ")).toEqual([]);
    for (const input of ['""', "--flag value", "{}", "[1]", "null"]) {
      expect(() => parseArgsEnv(input)).toThrow(/JSON array of strings/);
    }
  });

  test("rejects unknown runtime flags", () => {
    expect(() => parseRuntimeArgs(["--unknown"])).toThrow(/Unknown argument/);
  });
});
