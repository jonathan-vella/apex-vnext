import assert from "node:assert/strict";
import test from "node:test";
import {
  registryDiagnostic,
  reportRegistryValidation,
  requestedReportFormat,
} from "../../scripts/_lib/registry-validator-reporter.mjs";

function capture(callback) {
  const original = { log: console.log, error: console.error };
  const output = { log: [], error: [] };
  console.log = (...values) => output.log.push(values.join(" "));
  console.error = (...values) => output.error.push(values.join(" "));
  try {
    const status = callback();
    return { status, stdout: output.log.join("\n"), stderr: output.error.join("\n") };
  } finally {
    console.log = original.log;
    console.error = original.error;
  }
}

test("renders stable human diagnostics and preserves failure status", () => {
  const { status, stdout, stderr } = capture(() =>
    reportRegistryValidation({
      title: "Registry Validator",
      source: "tools/registry/example.json",
      errors: ["first error", ".github/workflows/ci.yml: second error"],
      passMessage: "Registry is valid",
    }),
  );

  assert.equal(status, 1);
  assert.equal(
    stdout,
    [
      "\n🔍 Registry Validator\n",
      `\n${"─".repeat(50)}`,
      "Checked: 1 | Errors: 2 | Warnings: 0",
      "\n❌ 2 error(s) found",
    ].join("\n"),
  );
  assert.equal(
    stderr,
    ["  ❌ tools/registry/example.json: first error", "  ❌ .github/workflows/ci.yml: second error"].join("\n"),
  );
});

test("renders deterministic machine-readable findings and preserves failure status", () => {
  const { status, stdout, stderr } = capture(() =>
    reportRegistryValidation({
      title: "Registry Validator",
      source: "tools/registry/example.json",
      errors: ["first error", ".github/workflows/ci.yml: second error"],
      passMessage: "Registry is valid",
      format: "json",
    }),
  );

  assert.equal(status, 1);
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), {
    summary: { errors: 2, warns: 0, infos: 0 },
    findings: [
      {
        check: "Registry Validator",
        severity: "error",
        file: "tools/registry/example.json",
        message: "first error",
      },
      {
        check: "Registry Validator",
        severity: "error",
        file: ".github/workflows/ci.yml",
        message: "second error",
      },
    ],
  });
});

test("extracts only path-like diagnostic prefixes", () => {
  assert.deepEqual(registryDiagnostic("registry.json", "docs/file.md: invalid"), {
    file: "docs/file.md",
    message: "invalid",
  });
  assert.deepEqual(registryDiagnostic("registry.json", "validate:example: unknown dependency"), {
    file: "registry.json",
    message: "validate:example: unknown dependency",
  });
});

test("recognizes explicit JSON format requests", () => {
  assert.equal(requestedReportFormat([]), "text");
  assert.equal(requestedReportFormat(["--format=json"]), "json");
});
