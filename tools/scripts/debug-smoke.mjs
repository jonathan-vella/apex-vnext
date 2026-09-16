#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

const root = fileURLToPath(new URL("../../", import.meta.url));

function port(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!/^\d+$/u.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} must be a port between 1 and 65535`);
  }
  return value;
}

async function post(endpoint, signal, payload) {
  const response = await fetch(`${endpoint}/v1/${signal}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, `${signal}: HTTP ${response.status}`);
  const result = await response.json();
  const partial = result.partialSuccess ?? {};
  assert.equal(Number(partial.rejectedSpans ?? partial.rejectedLogRecords ?? 0), 0);
  assert.ok(!partial.errorMessage, `${signal}: collector reported partial success`);
}

async function waitForStored(workspaceId, traceId) {
  const query = `union withsource=Table AppDependencies, AppTraces | where TimeGenerated > ago(1h) | where OperationId == '${traceId}' | summarize Records=count() by Table`;
  let lastError = "No matching rows yet";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const output = execFileSync(
        "az",
        [
          "rest",
          "--method",
          "post",
          "--url",
          `https://api.loganalytics.io/v1/workspaces/${workspaceId}/query`,
          "--resource",
          "https://api.loganalytics.io",
          "--body",
          JSON.stringify({ query }),
          "--only-show-errors",
          "-o",
          "json",
        ],
        { cwd: root, encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] },
      );
      const result = JSON.parse(output);
      const table = result.tables?.[0];
      const nameIndex = table?.columns.findIndex((column) => column.name === "Table");
      const countIndex = table?.columns.findIndex((column) => column.name === "Records");
      if (
        ["AppDependencies", "AppTraces"].every((name) =>
          table?.rows.some((row) => row[nameIndex] === name && row[countIndex] > 0),
        )
      )
        return;
    } catch (error) {
      if (error.code === "ENOENT") throw new Error("Azure CLI is not available", { cause: error });
      lastError = error.stderr?.toString() ?? "Azure query failed";
    }
    await setTimeout(5000);
  }
  throw new Error(`Synthetic telemetry was not queryable in Azure; run npm run debug:logs. ${lastError}`);
}

async function main() {
  const httpPort = port("APEX_DEBUG_HTTP_PORT", "4318");
  const endpoint = `http://127.0.0.1:${httpPort}`;
  const state = JSON.parse(readFileSync(join(root, "tools/debug/.local/deployment.json"), "utf8"));
  const workspace = JSON.parse(
    execFileSync(
      "az",
      [
        "resource",
        "show",
        "--ids",
        state.outputs.workspaceResourceId.value,
        "--api-version",
        "2025-07-01",
        "--only-show-errors",
        "-o",
        "json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );

  const runId = randomUUID();
  const traceId = randomBytes(16).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  const timestamp = BigInt(Date.now()) * 1000000n;
  const attributes = [{ key: "apex.debug.run_id", value: { stringValue: runId } }];
  const resource = { attributes: [{ key: "service.name", value: { stringValue: "apex-debug-smoke" } }] };
  const scope = { name: "apex-debug-smoke", version: "1.0.0" };

  await post(endpoint, "traces", {
    resourceSpans: [
      {
        resource,
        scopeSpans: [
          {
            scope,
            spans: [
              {
                traceId,
                spanId,
                name: "apex.debug.smoke",
                kind: 1,
                startTimeUnixNano: timestamp.toString(),
                endTimeUnixNano: (timestamp + 1000000n).toString(),
                attributes,
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  });
  await post(endpoint, "logs", {
    resourceLogs: [
      {
        resource,
        scopeLogs: [
          {
            scope,
            logRecords: [
              {
                timeUnixNano: timestamp.toString(),
                observedTimeUnixNano: timestamp.toString(),
                severityNumber: 9,
                severityText: "INFO",
                traceId,
                spanId,
                body: { stringValue: `APEX synthetic debug smoke ${runId}` },
                attributes,
              },
            ],
          },
        ],
      },
    ],
  });

  console.log(`Synthetic telemetry sent. Waiting for Azure ingestion. Trace ID: ${traceId}`);
  await waitForStored(workspace.properties.customerId, traceId);
  writeFileSync(
    join(root, "tools/debug/.local/last-smoke.json"),
    `${JSON.stringify({
      traceId,
      runId,
      workspaceId: workspace.properties.customerId,
      verifiedAt: new Date().toISOString(),
    })}\n`,
    { mode: 0o600 },
  );
  console.log(
    `PASS: synthetic log and trace ingested and queryable in Azure.\nTrace ID: ${traceId}\nSmoke run: ${runId}`,
  );
}

main().catch((error) => {
  console.error(`Debug smoke failed: ${error.message}`);
  process.exitCode = 1;
});
