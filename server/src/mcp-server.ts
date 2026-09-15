import readline from "node:readline";
import type { JsonSchema, Schema } from "./schema.js";

type ToolResult = {
  content: Array<{ type: string; [key: string]: unknown }>;
  isError?: boolean;
};

type ToolHandler = (args: any) => ToolResult | Promise<ToolResult>;
type Shape = Record<string, Schema>;

interface ToolDefinition {
  name: string;
  description: string;
  shape: Shape;
  inputSchema: JsonSchema;
  handler: ToolHandler;
}

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}

export class McpServer {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(
    private readonly serverInfo: { name: string; version: string },
    private readonly options: { instructions?: string } = {},
  ) {}

  tool(name: string, description: string, shape: Shape, handler: ToolHandler): void {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [field, schema] of Object.entries(shape)) {
      properties[field] = serializeSchema(schema);
      if (!schema.isOptional) required.push(field);
    }
    this.tools.set(name, {
      name,
      description,
      shape,
      inputSchema: {
        type: "object",
        properties,
        additionalProperties: false,
        ...(required.length ? { required } : {}),
      },
      handler,
    });
  }

  async start(): Promise<void> {
    const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let message: RpcMessage;
      try {
        message = JSON.parse(line) as RpcMessage;
      } catch {
        this.writeError(null, -32700, "Invalid JSON");
        continue;
      }
      await this.handle(message);
    }
  }

  private async handle(message: RpcMessage): Promise<void> {
    const id = message.id;
    if (!message.method) {
      if (id !== undefined) this.writeError(id, -32600, "Invalid request");
      return;
    }
    if (message.method.startsWith("notifications/")) return;

    try {
      switch (message.method) {
        case "initialize":
          this.writeResult(id, {
            protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
            capabilities: { tools: { listChanged: false } },
            serverInfo: this.serverInfo,
            instructions: this.options.instructions,
          });
          return;
        case "ping":
          this.writeResult(id, {});
          return;
        case "tools/list":
          this.writeResult(id, {
            tools: [...this.tools.values()].map(({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema,
            })),
          });
          return;
        case "tools/call":
          await this.callTool(id, message.params);
          return;
        case "resources/list":
          this.writeResult(id, { resources: [] });
          return;
        case "prompts/list":
          this.writeResult(id, { prompts: [] });
          return;
        case "logging/setLevel":
          this.writeResult(id, {});
          return;
        default:
          this.writeError(id, -32601, `Method not found: ${message.method}`);
      }
    } catch (error) {
      this.writeError(id, -32603, error instanceof Error ? error.message : String(error));
    }
  }

  private async callTool(id: RpcMessage["id"], params: any): Promise<void> {
    const tool = this.tools.get(params?.name);
    if (!tool) {
      this.writeError(id, -32602, "Unknown tool");
      return;
    }
    const args = params?.arguments ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      this.writeError(id, -32602, "Tool arguments must be an object");
      return;
    }
    for (const [field, schema] of Object.entries(tool.shape)) {
      const error = schema.validate(args[field], field);
      if (error) {
        this.writeResult(id, { content: [{ type: "text", text: error }], isError: true });
        return;
      }
    }
    this.writeResult(id, await tool.handler(args));
  }

  private writeResult(id: RpcMessage["id"], result: unknown): void {
    if (id === undefined) return;
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  private writeError(id: RpcMessage["id"], code: number, message: string): void {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }) + "\n");
  }
}

function serializeSchema(schema: Schema): JsonSchema {
  const json: JsonSchema = {};
  for (const [key, value] of Object.entries(schema.json)) {
    json[key] = value instanceof Object && "json" in value ? serializeSchema(value as Schema) : value;
  }
  return json;
}
