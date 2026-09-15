#!/usr/bin/env node
import { McpServer } from "./mcp-server.js";
import { registerTools } from "./tools.js";

const server = new McpServer(
  {
    name: "grok-imagine",
    version: "0.3.1",
  },
  {
    instructions:
      "Grok Imagine for agent hosts. Run grok_imagine_doctor for a no-generation setup check. Authentication is only through Grok CLI OAuth. For a visual pipeline, call open_flow_ui. Never print access tokens.",
  },
);

registerTools(server);

await server.start();
