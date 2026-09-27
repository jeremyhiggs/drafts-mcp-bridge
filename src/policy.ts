import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const READ_ONLY_TOOL_NAMES = new Set([
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
]);

export type ToolPolicy = {
  readOnly: boolean;
};

export function canExposeTool(toolName: string, policy: ToolPolicy): boolean {
  if (!policy.readOnly) {
    return true;
  }

  return READ_ONLY_TOOL_NAMES.has(toolName);
}

export function filterToolsForPolicy<T extends Pick<Tool, "name">>(
  tools: T[],
  policy: ToolPolicy,
): T[] {
  return tools.filter((tool) => canExposeTool(tool.name, policy));
}
