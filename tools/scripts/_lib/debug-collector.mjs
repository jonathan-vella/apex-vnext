import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as yaml from "js-yaml";
import { privateDirectory, readJson, savePrivate } from "./debug-workspaces.mjs";

export const COLLECTOR_IMAGE =
  "otel/opentelemetry-collector-contrib:0.156.0@sha256:125bdbeb7590cc1952c5b3430ecf14063568980c2c93d5b38676cc0446ed8108";

export function azure(args) {
  try {
    const text = execFileSync("az", [...args, "--only-show-errors", "-o", "json"], {
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return text.trim() ? JSON.parse(text) : null;
  } catch (error) {
    for (const key of Object.keys(error)) delete error[key];
    error.message =
      "Azure command failed; check az login, selected subscription, and read/ingestion permissions. Diagnostic output suppressed.";
    error.stack = error.message;
    throw error;
  }
}

export function collectorEnvironment(source = process.env) {
  const env = Object.fromEntries(
    Object.entries(source).filter(([key]) => !/^(AZURE_|APPLICATIONINSIGHTS_|OTEL_|COPILOT_OTEL_)/u.test(key)),
  );
  if (source.AZURE_CONFIG_DIR) env.AZURE_CONFIG_DIR = source.AZURE_CONFIG_DIR;
  return { ...env, AZURE_TOKEN_CREDENTIALS: "AzureCLICredential" };
}

export function hostConfiguration(base, registration, directory, connectionString) {
  const config = structuredClone(base);
  config.receivers.otlp.protocols = { http: { endpoint: `127.0.0.1:${registration.port}` } };
  config.extensions.azure_auth = { use_default: true, scopes: ["https://monitor.azure.com/.default"] };
  config.extensions.file_storage.directory = path.join(directory, "queue");
  config.service.telemetry = { metrics: { level: "none" } };
  config.exporters.azuremonitor.connection_string = connectionString;
  config.exporters.file = {
    path: path.join(directory, "telemetry.jsonl"),
    rotation: { max_megabytes: 5, max_backups: 2, max_days: 7 },
  };
  config.processors["resource/registration"] = {
    attributes: [{ key: "apex.debug.workspace_id", value: registration.id, action: "upsert" }],
  };
  for (const [signal, pipeline] of Object.entries(config.service.pipelines)) {
    pipeline.processors.splice(pipeline.processors.length - 1, 0, "resource/registration");
    if (signal !== "metrics") pipeline.exporters.push("file");
  }
  return config;
}

export function installCollector(local) {
  if (process.platform !== "linux") throw new Error("Host collector installation currently supports Linux/WSL2 only");
  const binary = path.join(local, "bin", "otelcol-contrib");
  if (fs.existsSync(binary)) return binary;
  privateDirectory(path.dirname(binary));
  const container = `apex-collector-extract-${randomUUID()}`;
  execFileSync("docker", ["create", "--name", container, COLLECTOR_IMAGE], { stdio: "ignore" });
  try {
    execFileSync("docker", ["cp", `${container}:/otelcol-contrib`, `${binary}.tmp`], { stdio: "ignore" });
    fs.chmodSync(`${binary}.tmp`, 0o700);
    const version = execFileSync(`${binary}.tmp`, ["--version"], { encoding: "utf8" });
    if (!version.includes("0.156.0")) throw new Error("Unexpected collector version");
    fs.renameSync(`${binary}.tmp`, binary);
  } finally {
    execFileSync("docker", ["rm", container], { stdio: "ignore" });
    if (fs.existsSync(`${binary}.tmp`)) fs.unlinkSync(`${binary}.tmp`);
  }
  return binary;
}

export function prepareCollector(root, local, registration, install = false) {
  const state = readJson(path.join(local, "deployment.json"));
  const account = azure(["account", "show"]);
  if (account.id !== state.config.subscriptionId || account.tenantId !== state.tenantId)
    throw new Error("Select the deployment subscription with az account set before starting capture");
  azure([
    "account",
    "get-access-token",
    "--resource",
    "https://monitor.azure.com/",
    "--query",
    "{expiresOn:expiresOn}",
  ]);
  const insights = azure([
    "resource",
    "show",
    "--ids",
    state.outputs.applicationInsightsResourceId.value,
    "--api-version",
    "2020-02-02",
  ]);
  if (insights.properties.DisableLocalAuth !== true) throw new Error("Entra-only ingestion must remain enabled");
  const binary = install ? installCollector(local) : path.join(local, "bin", "otelcol-contrib");
  if (!fs.existsSync(binary)) throw new Error("Run debug:collector with --install once to extract the pinned binary");
  const directory = path.dirname(registration.file);
  privateDirectory(path.join(directory, "queue"));
  const base = yaml.load(fs.readFileSync(path.join(root, "tools/debug/otel-collector.yaml"), "utf8"));
  const config = hostConfiguration(base, registration, directory, insights.properties.ConnectionString);
  const configPath = path.join(directory, "collector.yaml");
  savePrivate(configPath, yaml.dump(config));
  const env = collectorEnvironment();
  execFileSync(binary, ["validate", `--config=${configPath}`], { env, stdio: "pipe", timeout: 30000 });
  return { binary, configPath, env };
}

export async function runCollector(prepared, enabled = () => true) {
  process.umask(0o077);
  const child = spawn(prepared.binary, [`--config=${prepared.configPath}`], { env: prepared.env, stdio: "inherit" });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const registrationCheck = setInterval(() => {
    try {
      if (!enabled()) stop();
    } catch {
      stop();
    }
  }, 2000);
  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    clearInterval(registrationCheck);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
