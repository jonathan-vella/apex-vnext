import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { McpServer, Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { ApexService } from "../service.js";
import { createMcpServerFactory, type McpServerOptions, type McpServiceResolver } from "../mcp.js";

export const MCP_PROTOCOL_VERSION = "2026-07-28";

export function modernMcpClient(name: string): Client {
  return new Client({ name, version: "1.0.0" }, { versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } } });
}

export type McpTestSession = { client: Client; close(): Promise<void> };

/**
 * Connects a 2026-07-28 client in process through the same `serveStdio` entry `apex mcp serve` uses, with an
 * in-memory pair standing in for the stdio pipes.
 */
export async function connectMcpFactory(
  factory: () => Server | McpServer,
  name = "apex-test",
): Promise<McpTestSession> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(factory, { legacy: "serve", transport: serverTransport });
  const client = modernMcpClient(name);
  try {
    await client.connect(clientTransport);
  } catch (error) {
    await handle.close();
    throw error;
  }
  return {
    client,
    async close() {
      await client.close();
      await handle.close();
    },
  };
}

export function connectMcp(
  serviceOrResolver: ApexService | McpServiceResolver,
  options: McpServerOptions & { name?: string } = {},
): Promise<McpTestSession> {
  const { name, ...serverOptions } = options;
  return connectMcpFactory(createMcpServerFactory(serviceOrResolver, serverOptions), name);
}
