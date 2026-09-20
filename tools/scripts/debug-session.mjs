#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import {
  loadRegistry,
  registerWorkspace,
  disableWorkspace,
  workspaceId,
  cliEnvironment,
  readJson,
  savePrivate,
  DebugRegistrationError,
  vscodeUserSettings,
} from "./_lib/debug-workspaces.mjs";
import { prepareCollector, runCollector } from "./_lib/debug-collector.mjs";
import { assessmentPacket, readLocalEvidence, readAzureEvidence } from "./_lib/debug-evidence.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const local = path.join(root, "tools/debug/.local");

export function argumentsFor(args) {
  const divider = args.indexOf("--");
  const passthrough = divider < 0 ? [] : args.slice(divider + 1);
  const parsed = parseArgs({
    args: divider < 0 ? args : args.slice(0, divider),
    allowPositionals: true,
    strict: true,
    options: {
      workspace: { type: "string" },
      port: { type: "string" },
      auth: { type: "string", default: "azure-cli" },
      "log-root": { type: "string" },
      install: { type: "boolean", default: false },
      latest: { type: "boolean", default: false },
      since: { type: "string", default: "24" },
      limit: { type: "string", default: "200" },
      "include-local-content": { type: "boolean", default: false },
      "local-only": { type: "boolean", default: false },
    },
  });
  const [action, ...extra] = parsed.positionals;
  if (!["enable", "collector", "copilot", "assess", "disable"].includes(action) || extra.length)
    throw new Error("Expected enable|collector|copilot|assess|disable");
  if (parsed.values.auth !== "azure-cli") throw new Error("These development commands support --auth azure-cli only");
  if (passthrough.length && action !== "copilot") throw new Error("Only copilot accepts arguments after --");
  if (!/^\d+$/u.test(parsed.values.since) || Number(parsed.values.since) < 1 || Number(parsed.values.since) > 720)
    throw new Error("--since must be 1..720 hours");
  if (!/^\d+$/u.test(parsed.values.limit) || Number(parsed.values.limit) < 1 || Number(parsed.values.limit) > 500)
    throw new Error("--limit must be 1..500");
  return { action, options: parsed.values, passthrough };
}

async function checkReceiver(registration) {
  const response = await fetch(`http://127.0.0.1:${registration.port}/v1/traces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"resourceSpans":[]}',
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("Collector receiver is unavailable; start debug:collector");
}

async function main(args) {
  const { action, options, passthrough } = argumentsFor(args);
  const registry = loadRegistry(local);
  let registration;
  if (action === "enable") {
    if (!options.workspace) throw new Error("--workspace is required for explicit registration");
    const port = options.port ?? "14318";
    registration = registerWorkspace(local, options.workspace, { port, logRoot: options["log-root"] });
    try {
      await checkReceiver(registration);
      console.log("OTLP receiver reachable (not proof of Azure ingestion).");
    } catch {
      console.log("Collector not running for this registration yet.");
    }
    console.log(
      `Registered ${registration.workspace}\nWorkspace file: ${registration.file}\nStart capture in another terminal: npm run debug:collector -- --workspace "${registration.workspace}" --install\nRegistration does not enable VS Code capture. Copilot OTel settings are application-scoped: use a dedicated --user-data-dir instance, configure the following in its User settings, then open the workspace and reload. Workspace or profile settings alone are insufficient. No User settings, project settings or consumer files were changed. Verify environment/policy overrides and real client export.\n${JSON.stringify(vscodeUserSettings(registration.port), null, 2)}`,
    );
    return;
  }
  if (options.workspace)
    registration = registry.workspaces.find((entry) => entry.id === workspaceId(options.workspace));
  else {
    const active = registry.workspaces.filter((entry) => entry.enabled);
    if (active.length === 1) registration = active[0];
    else throw new Error("Specify --workspace when zero or multiple workspaces are registered");
  }
  if (!registration) throw new DebugRegistrationError("NOT_REGISTERED");
  if (action === "disable") {
    disableWorkspace(local, registration.workspace);
    console.log(
      "Registration disabled. Turn off github.copilot.chat.otel.enabled in the dedicated VS Code instance's User settings and reload, or close that instance. Exit any CLI launched for this registration. The managed host collector will stop; history is retained. User settings, organization policy and other exporters are not changed.",
    );
    return;
  }
  if (!registration.enabled) throw new Error("Registration is disabled");
  if (action === "collector") {
    const prepared = prepareCollector(root, local, registration, options.install);
    console.log(
      `Azure CLI collector for ${registration.id} on 127.0.0.1:${registration.port}. Ctrl+C stops capture. No service-principal credentials loaded.`,
    );
    process.exitCode = await runCollector(prepared, () =>
      loadRegistry(local).workspaces.some((entry) => entry.id === registration.id && entry.enabled),
    );
    return;
  }
  if (action === "copilot") {
    await checkReceiver(registration);
    let commit;
    try {
      commit = execFileSync("git", ["-C", registration.workspace, "rev-parse", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch {
      commit = "unknown";
    }
    const launchId = randomUUID();
    savePrivate(path.join(path.dirname(registration.file), "last-launch.json"), {
      launchId,
      commit,
      startedAt: new Date().toISOString(),
    });
    const child = spawn("copilot", passthrough, {
      cwd: registration.workspace,
      env: cliEnvironment(registration, launchId, commit),
      stdio: "inherit",
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    return;
  }
  const bounds = {
    sinceHours: Number(options.since),
    limit: Number(options.limit),
    includeContent: options["include-local-content"],
  };
  const evidence = readLocalEvidence(registration, bounds);
  let cloud = [];
  if (!options["local-only"]) {
    try {
      cloud = readAzureEvidence(readJson(path.join(local, "deployment.json")), registration, bounds);
    } catch {
      evidence.gaps.push(
        "Azure evidence unavailable; check az login and workspace query permissions. Local evidence does not prove cloud delivery.",
      );
    }
  } else evidence.gaps.push("Azure query skipped by --local-only.");
  if (cloud.length > bounds.limit)
    evidence.gaps.push("Azure query limit reached; narrow the time range to inspect more records.");
  const packet = assessmentPacket(registration, [...evidence.records, ...cloud], evidence.gaps, {
    latest: options.latest,
    limit: bounds.limit,
  });
  packet.coverage.localRecords = evidence.records.length;
  packet.coverage.azureRecords = cloud.length;
  if (!cloud.length && !options["local-only"])
    packet.coverage.gaps.push(
      "No Azure records returned for this scope and time window; local capture is not proof of Azure ingestion.",
    );
  packet.localExcerpts = evidence.excerpts;
  if (!packet.events.length)
    packet.coverage.gaps.push("No attributed events found; missing capture is not proof of successful behavior.");
  const report = path.join(path.dirname(registration.file), "assessment.json");
  savePrivate(report, packet);
  console.log(JSON.stringify(packet, null, 2));
  console.error(
    `Evidence packet saved to ${report}. An agent must inspect cited code/evidence before recommending changes.`,
  );
}

export function safeDebugError(error) {
  if (error instanceof DebugRegistrationError) {
    if (error.code === "PORT_ASSIGNED")
      return "Debug registration failed: port is assigned to another workspace. Retry debug:enable with a unique --port (for example --port 14319). Existing registrations are unchanged.";
    if (error.code === "NOT_REGISTERED")
      return "Debug workspace is not registered. Complete debug:enable successfully before starting debug:collector.";
  }
  return "Debug command failed. Check arguments, registration, az login, collector availability and permissions. No credentials printed.";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(safeDebugError(error));
    process.exitCode = 1;
  });
}
