import { writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

function createServer() {
  const server = new McpServer({
    name: "apex-host-feasibility",
    version: "0.0.1",
  });

  server.registerTool(
    "echo",
    {
      description: "Echo a text value for host feasibility testing.",
      inputSchema: z.object({
        text: z.string(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ text }) => ({
      content: [{ type: "text", text }],
      structuredContent: { text },
    }),
  );

  server.registerTool(
    "write_probe",
    {
      description: "Write a disposable host-feasibility marker into an explicitly supplied absolute workspace.",
      inputSchema: z.object({
        workspace: z.string(),
        text: z.string(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ workspace, text }) => {
      if (!isAbsolute(workspace)) {
        throw new Error("workspace must be an absolute path");
      }

      const path = join(workspace, "host-feasibility-probe.txt");
      await writeFile(path, `${text}\n`, "utf8");
      return {
        content: [{ type: "text", text: path }],
        structuredContent: { path },
      };
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
