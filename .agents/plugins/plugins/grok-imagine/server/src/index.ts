#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const server = new McpServer(
  {
    name: "grok-imagine",
    version: "0.1.0",
  },
  {
    instructions:
      "Grok Imagine for Codex. Auth is Grok CLI OAuth (grok login --oauth). For a visual n8n-style pipeline (image→video), call open_flow_ui so the user can inspect/run the live canvas at 127.0.0.1. Direct generate_image / generate_video tools still work. Never print access tokens.",
  },
);

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
