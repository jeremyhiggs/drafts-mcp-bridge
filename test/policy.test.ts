import { describe, expect, test } from "vitest";
import { canExposeTool, filterToolsForPolicy, READ_ONLY_TOOL_NAMES } from "../src/policy.js";

const PINNED_UPSTREAM_TOOL_NAMES = [
  "drafts_list_workspaces",
  "drafts_list_tags",
  "drafts_get_tag",
  "drafts_get_current_workspace",
  "drafts_get_current",
  "drafts_get_workspace_drafts",
  "drafts_get_drafts",
  "drafts_create_draft",
  "drafts_get_draft",
  "drafts_update_draft",
  "drafts_add_tags",
  "drafts_search",
  "drafts_run_action",
  "drafts_list_actions",
  "drafts_flag",
  "drafts_archive",
  "drafts_inbox",
  "drafts_trash",
  "drafts_open",
  "drafts_open_workspace",
] as const;

const EXPECTED_READ_ONLY_TOOL_NAMES = [
  "drafts_list_workspaces",
  "drafts_list_tags",
  "drafts_get_tag",
  "drafts_get_current_workspace",
  "drafts_get_current",
  "drafts_get_workspace_drafts",
  "drafts_get_drafts",
  "drafts_get_draft",
  "drafts_search",
  "drafts_list_actions",
  "drafts_open",
] as const;

describe("Drafts tool policy", () => {
  test("classifies the complete pinned upstream inventory", () => {
    const classified = PINNED_UPSTREAM_TOOL_NAMES.filter((name) => READ_ONLY_TOOL_NAMES.has(name));

    expect(classified).toEqual(EXPECTED_READ_ONLY_TOOL_NAMES);
    expect(PINNED_UPSTREAM_TOOL_NAMES).toHaveLength(20);
  });

  test("fails closed for mutators, UI actions, action execution, and unknown tools", () => {
    for (const name of [
      "drafts_create_draft",
      "drafts_update_draft",
      "drafts_add_tags",
      "drafts_run_action",
      "drafts_flag",
      "drafts_archive",
      "drafts_inbox",
      "drafts_trash",
      "drafts_open_workspace",
      "drafts_future_tool",
    ]) {
      expect(canExposeTool(name, { readOnly: true })).toBe(false);
    }
  });

  test("exposes all advertised tools only when write mode is explicit", () => {
    const tools = PINNED_UPSTREAM_TOOL_NAMES.map((name) => ({ name }));

    expect(filterToolsForPolicy(tools, { readOnly: false })).toEqual(tools);
    expect(filterToolsForPolicy(tools, { readOnly: true }).map((tool) => tool.name)).toEqual(
      EXPECTED_READ_ONLY_TOOL_NAMES,
    );
  });
});
