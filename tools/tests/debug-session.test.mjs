import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  registerWorkspace,
  disableWorkspace,
  readJson,
  cliEnvironment,
  endpointPort,
  DebugRegistrationError,
  vscodeUserSettings,
} from "../scripts/_lib/debug-workspaces.mjs";
import { collectorEnvironment, hostConfiguration } from "../scripts/_lib/debug-collector.mjs";
import * as yaml from "js-yaml";
import {
  evidenceQuery,
  normalizeOtlp,
  assessmentPacket,
  readLocalEvidence,
  redact,
} from "../scripts/_lib/debug-evidence.mjs";
import { argumentsFor, safeDebugError } from "../scripts/debug-session.mjs";

test("port conflicts explain recovery without changing registrations or exposing errors", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apex-debug-ports-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, "local");
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  registerWorkspace(local, first);
  const before = fs.readFileSync(path.join(local, "workspaces.json"), "utf8");
  assert.throws(
    () => registerWorkspace(local, second),
    (error) => {
      assert.match(safeDebugError(error), /unique --port/);
      return error instanceof DebugRegistrationError && error.code === "PORT_ASSIGNED";
    },
  );
  assert.equal(fs.readFileSync(path.join(local, "workspaces.json"), "utf8"), before);
  assert.equal(registerWorkspace(local, second, { port: 14319 }).port, 14319);
  assert.match(safeDebugError(new DebugRegistrationError("NOT_REGISTERED")), /Complete debug:enable/);
  assert.doesNotMatch(safeDebugError(new Error("Bearer secret-value")), /secret-value/);
});

test("command options reject unknown flags and unbounded reads", () => {
  assert.throws(() => argumentsFor(["assess", "--limit", "0"]));
  assert.throws(() => argumentsFor(["assess", "--since", "9999"]));
  assert.throws(() => argumentsFor(["assess", "--unknown"]));
  assert.throws(() => argumentsFor(["enable", "--auth", "secret"]));
  assert.deepEqual(argumentsFor(["copilot", "--workspace", "/project", "--", "--help"]).passthrough, ["--help"]);
});

test("evidence queries are scoped and bounded and assessment distinguishes error evidence from cause", () => {
  assert.throws(() => evidenceQuery("' | take 9999", 24, 100));
  assert.throws(() => evidenceQuery("a".repeat(24), 721, 100));
  assert.throws(() => evidenceQuery("a".repeat(24), 24, 501));
  assert.match(evidenceQuery("a".repeat(24), 24, 100), /take 101/u);
  const spans = normalizeOtlp(
    {
      resourceSpans: [
        {
          resource: { attributes: [] },
          scopeSpans: [
            {
              spans: [
                {
                  name: "execute_tool",
                  traceId: "trace",
                  spanId: "span",
                  startTimeUnixNano: "1789732800000000000",
                  status: { code: 2, message: "secret" },
                  attributes: [
                    { key: "gen_ai.input.messages", value: { stringValue: "private" } },
                    { key: "error.type", value: { stringValue: "Timeout" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    { file: "fixture", line: 1 },
  );
  assert.equal(spans[0].attributes["gen_ai.input.messages"], undefined);
  assert.doesNotMatch(JSON.stringify(spans), /private|secret/u);
  const packet = assessmentPacket({ workspace: "/project", id: "id" }, [...spans, ...spans], [], { latest: true });
  assert.equal(packet.events.length, 1);
  assert.equal(packet.candidates[0].confidence, "observed-event-only");
  assert.equal(packet.coverage.completeSession, false);
  const rounded = { ...spans[0], time: "2026-09-18T12:00:00.001Z", source: { table: "AppDependencies" } };
  const merged = assessmentPacket({ workspace: "/project", id: "id" }, [spans[0], rounded]);
  assert.equal(merged.events.length, 1);
  assert.equal(merged.events[0].sources.length, 2);
  assert.equal(redact("Bearer abc123"), "[REDACTED]");
});

test("local evidence refuses symlink escapes and reports missing sources", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apex-evidence-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "approved");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(root, "outside.log"), "error sensitive\n");
  fs.symlinkSync(path.join(root, "outside.log"), path.join(directory, "escape.log"));
  const result = readLocalEvidence(
    { file: path.join(directory, "test.code-workspace"), id: "id", logRoot: directory },
    { includeContent: true },
  );
  assert.equal(result.excerpts.length, 0);
  assert.ok(readLocalEvidence({ file: path.join(directory, "test.code-workspace"), id: "id" }).gaps.length);
  fs.writeFileSync(path.join(directory, "diagnostic.log"), "error token=supersecret denied\n");
  const withoutContent = readLocalEvidence({
    file: path.join(directory, "test.code-workspace"),
    id: "id",
    logRoot: directory,
  });
  assert.equal(withoutContent.excerpts.length, 0);
  const withContent = readLocalEvidence(
    { file: path.join(directory, "test.code-workspace"), id: "id", logRoot: directory },
    { includeContent: true },
  );
  assert.equal(withContent.excerpts.length, 1);
  assert.doesNotMatch(withContent.excerpts[0].text, /supersecret/u);
  assert.equal(withContent.excerpts[0].line, 1);
  fs.writeFileSync(path.join(directory, "huge.log"), Buffer.alloc(6 * 1024 * 1024 + 1));
  assert.ok(
    readLocalEvidence(
      { file: path.join(directory, "test.code-workspace"), id: "id", logRoot: directory },
      { includeContent: true },
    ).gaps.some((gap) => gap.includes("budget")),
  );
});

test("host collector restricts credentials to Azure CLI and binds only loopback", () => {
  const env = collectorEnvironment({
    PATH: "/bin",
    AZURE_CLIENT_SECRET: "secret",
    AZURE_TENANT_ID: "other",
    AZURE_TOKEN_CREDENTIALS: "prod",
    APPLICATIONINSIGHTS_CONNECTION_STRING: "other",
  });
  assert.deepEqual(env, { PATH: "/bin", AZURE_TOKEN_CREDENTIALS: "AzureCLICredential" });
  const base = yaml.load(fs.readFileSync("tools/debug/otel-collector.yaml", "utf8"));
  const config = hostConfiguration(base, { id: "test", port: 14318 }, "/private", "connection");
  assert.equal(config.extensions.azure_auth.service_principal, undefined);
  assert.equal(config.extensions.azure_auth.use_default, true);
  assert.equal(config.service.telemetry.metrics.level, "none");
  assert.equal(config.receivers.otlp.protocols.http.endpoint, "127.0.0.1:14318");
  assert.equal(config.exporters.file.rotation.max_backups, 2);
  assert.ok(config.service.pipelines.traces.processors.includes("transform/privacy"));
  assert.ok(config.service.pipelines.logs.processors.includes("resource/registration"));
  assert.equal(base.extensions.azure_auth.use_default, undefined);
});

test("registration is idempotent and disabling preserves project settings and workspace edits", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apex-debug-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, "local");
  const workspace = path.join(root, "project");
  fs.mkdirSync(path.join(workspace, ".vscode"), { recursive: true });
  const original = '{ // user setting\n "editor.tabSize": 4,\n}\n';
  fs.writeFileSync(path.join(workspace, ".vscode/settings.json"), original);
  const registered = registerWorkspace(local, workspace);
  assert.equal(
    Object.keys(readJson(registered.file).settings).some((key) => key.startsWith("github.copilot.chat.otel.")),
    false,
  );
  assert.deepEqual(registerWorkspace(local, workspace), registered);
  fs.writeFileSync(
    registered.file,
    fs
      .readFileSync(registered.file, "utf8")
      .replace(
        '"settings": {',
        '"settings": {\n // keep me\n "editor.wordWrap": "on",\n "github.copilot.chat.otel.enabled": true,',
      ),
  );
  assert.deepEqual(registerWorkspace(local, workspace), registered);
  assert.equal(readJson(registered.file).settings["github.copilot.chat.otel.enabled"], undefined);
  disableWorkspace(local, workspace);
  assert.equal(readJson(registered.file).settings["github.copilot.chat.otel.enabled"], undefined);
  assert.equal(readJson(registered.file).settings["editor.wordWrap"], "on");
  assert.match(fs.readFileSync(registered.file, "utf8"), /keep me/u);
  assert.equal(fs.readFileSync(path.join(workspace, ".vscode/settings.json"), "utf8"), original);
  assert.equal(fs.statSync(registered.file).mode & 0o777, 0o600);
  const reenabled = registerWorkspace(local, workspace);
  assert.equal(readJson(reenabled.file).settings["github.copilot.chat.otel.enabled"], undefined);
  assert.equal(readJson(reenabled.file).settings["editor.wordWrap"], "on");
});

test("VS Code setup supplies application-scoped metadata-only settings for the registered port", () => {
  assert.deepEqual(vscodeUserSettings(14322), {
    "github.copilot.chat.otel.enabled": true,
    "github.copilot.chat.otel.exporterType": "otlp-http",
    "github.copilot.chat.otel.otlpEndpoint": "http://127.0.0.1:14322",
    "github.copilot.chat.otel.captureContent": false,
  });
  assert.throws(() => vscodeUserSettings("14322/path"), /Port must/);
});

test("CLI launch removes inherited exporters, secrets in headers, and content capture overrides", () => {
  const env = cliEnvironment({ id: "workspace", port: 14318 }, "launch", "commit", {
    PATH: "/bin",
    OTEL_EXPORTER_OTLP_HEADERS: "secret",
    COPILOT_OTEL_FILE_EXPORTER_PATH: "/tmp/leak",
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true",
  });
  assert.equal(env.OTEL_EXPORTER_OTLP_HEADERS, undefined);
  assert.equal(env.COPILOT_OTEL_FILE_EXPORTER_PATH, undefined);
  assert.equal(env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT, "false");
  assert.equal(env.PATH, "/bin");
  assert.throws(() => endpointPort("14318/path"));
  assert.throws(() => endpointPort("0"));
});
