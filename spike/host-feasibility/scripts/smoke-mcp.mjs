import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const protocolVersion = "2026-07-28";
const modernMeta = {
  "io.modelcontextprotocol/protocolVersion": protocolVersion,
  "io.modelcontextprotocol/clientInfo": {
    name: "host-feasibility-smoke",
    version: "1.0.0",
  },
  "io.modelcontextprotocol/clientCapabilities": {},
};
const child = spawn(process.execPath, [resolve(root, "server/index.mjs")], {
  cwd: root,
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
let stderr = "";
child.stderr.setEncoding("utf8").on("data", (chunk) => {
  stderr += chunk;
});

const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
let nextId = 0;

async function request(method, params = {}) {
  const id = ++nextId;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  const result = await Promise.race([
    lines.next(),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for ${method}: ${stderr}`)), 10_000).unref();
    }),
  ]);
  if (result.done) throw new Error(`Server closed while waiting for ${method}: ${stderr}`);
  const response = JSON.parse(result.value);
  assert.equal(response.id, id);
  if (response.error) throw new Error(`${method} failed: ${JSON.stringify(response.error)}`);
  return response.result;
}

try {
  const discovered = await request("server/discover", { _meta: modernMeta });
  assert.ok(discovered.supportedVersions.includes(protocolVersion));

  const tools = await request("tools/list", { _meta: modernMeta });
  assert.deepEqual(
    tools.tools.map(({ name }) => name).sort(),
    ["echo", "write_probe"],
  );

  const echo = await request("tools/call", {
    name: "echo",
    arguments: { text: "HOST_PROBE_OK" },
    _meta: modernMeta,
  });
  assert.equal(echo.isError, undefined);
  assert.equal(echo.content[0].text, "HOST_PROBE_OK");

  const workspace = await mkdtemp(join(tmpdir(), "apex-host-feasibility-"));
  const write = await request("tools/call", {
    name: "write_probe",
    arguments: { workspace, text: "WRITE_PROBE_OK" },
    _meta: modernMeta,
  });
  const path = write.structuredContent.path;
  assert.equal(path, join(workspace, "host-feasibility-probe.txt"));
  assert.equal(await readFile(path, "utf8"), "WRITE_PROBE_OK\n");

  process.stdout.write("MCP 2026-07-28 echo/write_probe smoke passed.\n");
} finally {
  child.kill();
}
