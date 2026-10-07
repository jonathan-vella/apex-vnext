// Plugin MCP entry: build-plugin.mjs bundles this file and its imports into <plugin>/mcp/apex.mjs with esbuild.
// It runs the same `apex mcp serve` path as the CLI, so serveMcp owns stdio, discovery and the legacy fallback.
// eslint-disable-next-line n/no-extraneous-import -- esbuild resolves the npm workspace package at build time.
import { execute, normalizeError } from "@apexops/cli";

try {
  await execute(["mcp", "serve"]);
} catch (error) {
  const normalized = normalizeError(error);
  process.stderr.write(`${normalized.code}: ${normalized.message}\n`);
  process.exitCode = normalized.exitCode;
}
