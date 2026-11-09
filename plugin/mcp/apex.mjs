// Plugin MCP entry: build-plugin.mjs bundles this file and its imports into <plugin>/mcp/apex.mjs with esbuild.
// It runs the same `apex mcp serve` path as the CLI when executed directly, and exports the bundled CLI runtime for <plugin>/cli/apex.mjs.
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
// eslint-disable-next-line n/no-extraneous-import -- esbuild resolves the npm workspace package at build time.
import { execute, main, normalizeError } from "@apexops/cli";

export { execute, main, normalizeError };

const isDirectMcp =
  process.argv[1] !== undefined &&
  (await realpath(process.argv[1]).catch(() => process.argv[1])) ===
    (await realpath(fileURLToPath(import.meta.url)).catch(() => fileURLToPath(import.meta.url)));

if (isDirectMcp) {
  try {
    await execute(["mcp", "serve"]);
  } catch (error) {
    const normalized = normalizeError(error);
    process.stderr.write(`${normalized.code}: ${normalized.message}\n`);
    process.exitCode = normalized.exitCode;
  }
}
