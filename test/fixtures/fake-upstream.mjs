#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "fake-drafts-upstream",
  version: "0.0.0",
});

server.tool("drafts_get_current", "Read fake Drafts data", async () => ({
  content: [
    {
      type: "text",
      text: "fake database",
    },
  ],
}));

server.tool("drafts_create_draft", "Mutate fake Drafts data", async () => ({
  content: [
    {
      type: "text",
      text: "created",
    },
  ],
}));

await server.connect(new StdioServerTransport());
