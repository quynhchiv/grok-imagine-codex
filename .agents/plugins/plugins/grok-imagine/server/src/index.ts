#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const server = new McpServer(
  {
    name: "grok-imagine",
    version: "0.2.1",
  },
  {
    instructions:
      "Grok Imagine for Codex. Run grok_imagine_doctor for a no-generation setup check. XAI_API_KEY is preferred; Grok CLI OAuth is also supported. For a visual pipeline, call open_flow_ui. Never print access tokens.",
  },
);

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
