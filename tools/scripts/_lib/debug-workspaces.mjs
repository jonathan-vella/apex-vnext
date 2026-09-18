import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { parse, modify, applyEdits } from "jsonc-parser";

export function readJson(file) {
  const text = fs.readFileSync(file, "utf8");
  const errors = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error("Invalid JSON/JSONC configuration");
  return value;
}

export function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("Local state directory must not be a symlink");
  fs.chmodSync(directory, 0o700);
}

export function savePrivate(file, value) {
  privateDirectory(path.dirname(file));
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function workspaceId(workspace) {
  return createHash("sha256").update(fs.realpathSync(workspace)).digest("hex").slice(0, 24);
}

export function endpointPort(value = "14318") {
  if (!/^\d+$/u.test(String(value)) || Number(value) < 1024 || Number(value) > 65535)
    throw new Error("Port must be 1024..65535");
  return Number(value);
}

export function loadRegistry(local) {
  const file = path.join(local, "workspaces.json");
  return fs.existsSync(file) ? readJson(file) : { schemaVersion: 1, workspaces: [] };
}

export class DebugRegistrationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function registerWorkspace(local, workspace, { port = 14318, logRoot } = {}) {
  workspace = fs.realpathSync(workspace);
  if (!fs.statSync(workspace).isDirectory()) throw new Error("Workspace must be a directory");
  port = endpointPort(port);
  const registry = loadRegistry(local);
  const id = workspaceId(workspace);
  if (registry.workspaces.some((entry) => entry.id !== id && entry.enabled && entry.port === port))
    throw new DebugRegistrationError("PORT_ASSIGNED");
  const previous = registry.workspaces.find((entry) => entry.id === id);
  if (previous?.enabled) {
    if (previous.port !== port || (logRoot && fs.realpathSync(logRoot) !== previous.logRoot))
      throw new Error("Disable before changing a registration's port or diagnostic source");
    return previous;
  }
  const directory = path.join(local, "workspaces", id);
  privateDirectory(directory);
  if (logRoot) {
    logRoot = fs.realpathSync(logRoot);
    if (logRoot === path.parse(logRoot).root || logRoot === os.homedir() || logRoot === workspace)
      throw new Error("Choose a dedicated diagnostic directory, not a filesystem, home, or workspace root");
    if (!fs.statSync(logRoot).isDirectory())
      throw new Error("Diagnostic root must be a directory dedicated to this workspace");
  }
  const settings = {
    "github.copilot.chat.otel.enabled": true,
    "github.copilot.chat.otel.exporterType": "otlp-http",
    "github.copilot.chat.otel.otlpEndpoint": `http://127.0.0.1:${port}`,
    "github.copilot.chat.otel.captureContent": false,
  };
  const file = path.join(directory, "development.code-workspace");
  let document = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8")
    : JSON.stringify({ folders: [{ path: workspace }], settings: {} }, null, 2);
  if (fs.existsSync(file)) readJson(file);
  for (const [key, value] of Object.entries(settings)) {
    document = applyEdits(
      document,
      modify(document, ["settings", key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
    );
  }
  savePrivate(file, document);
  const registration = {
    id,
    workspace,
    port,
    enabled: true,
    registeredAt: new Date().toISOString(),
    file,
    logRoot: logRoot ?? previous?.logRoot ?? null,
  };
  registry.workspaces = [...registry.workspaces.filter((entry) => entry.id !== id), registration];
  savePrivate(path.join(local, "workspaces.json"), registry);
  return registration;
}

export function disableWorkspace(local, workspace) {
  const registry = loadRegistry(local);
  const registration = registry.workspaces.find((entry) => entry.id === workspaceId(workspace));
  if (!registration) throw new Error("Workspace is not registered");
  const document = fs.readFileSync(registration.file, "utf8");
  readJson(registration.file);
  savePrivate(
    registration.file,
    applyEdits(
      document,
      modify(document, ["settings", "github.copilot.chat.otel.enabled"], false, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    ),
  );
  registration.enabled = false;
  registration.disabledAt = new Date().toISOString();
  savePrivate(path.join(local, "workspaces.json"), registry);
  return registration;
}

export function cliEnvironment(registration, runId, commit, source = process.env) {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !/^(OTEL_|COPILOT_OTEL_)/u.test(key)));
  return {
    ...env,
    COPILOT_OTEL_ENABLED: "true",
    COPILOT_OTEL_EXPORTER_TYPE: "otlp-http",
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${registration.port}`,
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "false",
    COPILOT_OTEL_CAPTURE_CONTENT: "false",
    OTEL_RESOURCE_ATTRIBUTES: `apex.debug.workspace_id=${registration.id},apex.debug.launch_id=${runId},apex.debug.commit=${commit}`,
  };
}
