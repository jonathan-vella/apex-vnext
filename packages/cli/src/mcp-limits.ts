/** The largest serialized MCP tool result: structured content plus its escaped text copy. */
export const MCP_MAX_SERIALIZED_RESULT_BYTES = 64 * 1024;

/** Bytes of the MCP result for a structured value, which carries its JSON twice (structured and as escaped text). */
export function mcpResultEnvelopeBytes(structuredContent: Record<string, unknown>): number {
  const text = JSON.stringify(structuredContent);
  return Buffer.byteLength(
    JSON.stringify({
      content: [{ type: "text", text }],
      structuredContent,
    }),
    "utf8",
  );
}
