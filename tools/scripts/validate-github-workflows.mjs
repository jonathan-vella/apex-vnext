#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import * as yaml from "js-yaml";
import { reportRegistryValidation, requestedReportFormat } from "./_lib/registry-validator-reporter.mjs";

const CONTRACT_PATH = "tools/registry/github-workflow-contract.json";
const SCHEMA_PATH = "tools/registry/schemas/github-workflow-contract.schema.json";
const WORKFLOW_DIRECTORY = ".github/workflows";

export const EXPECTED_REQUIRED_CONTEXTS = [
  "ci",
  "External Python tests (apex-recall + azure-pricing MCP)",
  "Analyze (actions)",
  "Analyze (javascript-typescript)",
  "Analyze (python)",
];

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object" || value === undefined) throw new TypeError("Unsupported workflow contract value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function workflowContractDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function sectionDigest(value, path, section, errors) {
  try {
    if (value === undefined) throw new TypeError("section is missing");
    return workflowContractDigest(value);
  } catch (error) {
    errors.push(`${path}: ${section} contract cannot be hashed: ${error.message}`);
    return null;
  }
}

function workflowActions(value) {
  const actions = [];
  for (const job of Object.values(value.jobs ?? {})) {
    if (job === null || typeof job !== "object" || Array.isArray(job)) continue;
    if (typeof job.uses === "string") actions.push(job.uses);
    if (!Array.isArray(job.steps)) continue;
    for (const step of job.steps) {
      if (step !== null && typeof step === "object" && typeof step.uses === "string") actions.push(step.uses);
    }
  }
  return actions.filter((action) => !action.startsWith("./"));
}

function workflowLocalActions(value) {
  const actions = [];
  for (const job of Object.values(value.jobs ?? {})) {
    if (job === null || typeof job !== "object" || Array.isArray(job) || !Array.isArray(job.steps)) continue;
    for (const step of job.steps) {
      if (step !== null && typeof step === "object" && typeof step.uses === "string" && step.uses.startsWith("./")) {
        const path = step.uses.replace(/^\.\//u, "");
        actions.push(path.endsWith(".yml") || path.endsWith(".yaml") ? path : `${path}/action.yml`);
      }
    }
  }
  return actions;
}

function workflowScripts(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
  const jobs = value.jobs;
  if (jobs === null || typeof jobs !== "object" || Array.isArray(jobs)) return "";
  return Object.values(jobs)
    .filter((job) => job !== null && typeof job === "object" && !Array.isArray(job))
    .flatMap((job) => (Array.isArray(job.steps) ? job.steps : []))
    .filter((step) => step !== null && typeof step === "object")
    .map((step) => (typeof step.run === "string" ? step.run : ""))
    .join("\n");
}

function validatePythonSetupAction(text) {
  let value;
  try {
    value = yaml.load(text);
  } catch (error) {
    return [`Python setup action YAML parse failed: ${error.message}`];
  }
  const steps = value?.runs?.steps;
  const exactKeys = (object, expected) =>
    object !== null &&
    typeof object === "object" &&
    !Array.isArray(object) &&
    JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...expected].sort());
  const errors = [];
  if (
    !exactKeys(value, ["name", "description", "runs"]) ||
    !exactKeys(value?.runs, ["using", "steps"]) ||
    value?.runs?.using !== "composite"
  ) {
    errors.push("Python setup action structure or runtime drift");
  }
  if (!Array.isArray(steps) || steps.length !== 2) return ["Python setup action must contain exactly two steps"];
  const [setup, install] = steps;
  const expectedInstall = [
    "set -euo pipefail",
    "python -m pip install --upgrade pip",
    "python -m pip install -e tools/apex-recall",
    "python -m pip install -e 'tools/mcp-servers/azure-pricing[dev]'",
    "python -m pip install pytest",
    "python -m venv tools/mcp-servers/azure-pricing/.venv",
    "tools/mcp-servers/azure-pricing/.venv/bin/python -m pip install --upgrade pip",
    "tools/mcp-servers/azure-pricing/.venv/bin/python -m pip install \\",
    "-e 'tools/mcp-servers/azure-pricing[admin,dev]'",
  ];
  const actualInstall = String(install?.run ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    !exactKeys(setup, ["name", "uses", "with"]) ||
    !exactKeys(setup?.with, ["python-version", "cache"]) ||
    setup?.uses !== "actions/setup-python@v6" ||
    setup.with?.["python-version"] !== "3.14" ||
    setup.with?.cache !== "pip"
  ) {
    errors.push("Python setup action version or cache contract drift");
  }
  if (
    !exactKeys(install, ["name", "shell", "run"]) ||
    install?.shell !== "bash" ||
    JSON.stringify(actualInstall) !== JSON.stringify(expectedInstall)
  ) {
    errors.push("Python setup action dependency bootstrap drift");
  }
  return errors;
}

function containsForbiddenReleaseAuthority(script) {
  for (const line of script.split(/\r?\n/u)) {
    const tokens = line
      .split(/[\s;&|()]+/u)
      .map((token) => token.replace(/^["']|["'\\]$/gu, ""))
      .filter(Boolean);
    for (const [index, rawToken] of tokens.entries()) {
      const token = rawToken.split("/").at(-1);
      const following = tokens.slice(index + 1);
      if (token === "terraform" && following.includes("apply")) return true;
      if (token === "azd" && following.some((value) => value === "deploy" || value === "up")) return true;
      if (token === "npm" && following.some((value) => value === "publish" || value === "pub")) return true;
      if (token === "git" && following.some((value) => value === "tag" || value === "push")) return true;
      if (
        token === "gh" &&
        (following.join(" ").includes("pr merge") || following.join(" ").includes("release create"))
      ) {
        return true;
      }
      if (
        token === "gh" &&
        following[0] === "api" &&
        (following.some((value) => /^--method=(?:POST|PUT|PATCH|DELETE)$/iu.test(value)) ||
          following.some((value) => /^-X(?:POST|PUT|PATCH|DELETE)$/iu.test(value)) ||
          following.some(
            (value, offset) =>
              (value === "--method" || value === "-X") &&
              ["POST", "PUT", "PATCH", "DELETE"].includes(following[offset + 1]?.toUpperCase()),
          ) ||
          following.some(
            (value) =>
              value === "-f" ||
              value === "-F" ||
              value === "--field" ||
              value === "--raw-field" ||
              value === "--input" ||
              /^-[fF].+/u.test(value) ||
              value.startsWith("--field=") ||
              value.startsWith("--raw-field=") ||
              value.startsWith("--input="),
          ))
      ) {
        return true;
      }
      if (token === "az" && following.includes("deployment")) return true;
    }
  }
  return false;
}

export function loadWorkflowTexts(directory = WORKFLOW_DIRECTORY) {
  return Object.fromEntries(
    readdirSync(directory)
      .filter((name) => /\.ya?ml$/u.test(name))
      .sort()
      .map((name) => [`${directory}/${name}`, readFileSync(`${directory}/${name}`, "utf8")]),
  );
}

export function loadLocalActionTexts(paths) {
  return Object.fromEntries(
    paths.map((path) => {
      try {
        return [path, readFileSync(path, "utf8")];
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          return [path, undefined];
        }
        throw error;
      }
    }),
  );
}

export function validateGithubWorkflowContract({ contract, schema, workflowTexts, localActionTexts = {} }) {
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  if (!ajv.validate(schema, contract)) {
    return (ajv.errors ?? []).map((error) => `schema ${error.instancePath || "/"}: ${error.message}`);
  }
  const ids = contract.workflows.map(({ id }) => id);
  const paths = contract.workflows.map(({ path }) => path);
  if (new Set(ids).size !== ids.length) errors.push("workflow IDs must be unique");
  if (new Set(paths).size !== paths.length) errors.push("workflow paths must be unique");
  if (JSON.stringify(contract.expectedRequiredContexts) !== JSON.stringify(EXPECTED_REQUIRED_CONTEXTS)) {
    errors.push("offline expected status contexts drift from the recorded branch-protection snapshot");
  }
  if (!contract.managedContexts.every((context) => contract.expectedRequiredContexts.includes(context))) {
    errors.push("managed contexts must be a subset of offline expected contexts");
  }
  const actualPaths = Object.keys(workflowTexts).sort();
  if (JSON.stringify([...paths].sort()) !== JSON.stringify(actualPaths)) {
    errors.push("workflow file inventory drift");
  }
  for (const [path, expectedDigest] of Object.entries(contract.localActions)) {
    const text = localActionTexts[path];
    if (text === undefined) errors.push(`${path}: local action is missing`);
    else if (createHash("sha256").update(text).digest("hex") !== expectedDigest) {
      errors.push(`${path}: local action content drift`);
    }
  }
  const pythonActionPath = ".github/actions/setup-python-validation/action.yml";
  const pythonAction = localActionTexts[pythonActionPath];
  if (pythonAction !== undefined) {
    errors.push(...validatePythonSetupAction(pythonAction).map((error) => `${pythonActionPath}: ${error}`));
  }

  const values = new Map();
  const referencedLocalActions = new Set();
  for (const expected of contract.workflows) {
    const text = workflowTexts[expected.path];
    if (text === undefined) {
      errors.push(`${expected.path}: workflow file is missing`);
      continue;
    }
    let value;
    try {
      value = yaml.load(text);
    } catch (error) {
      errors.push(`${expected.path}: YAML parse failed: ${error.message}`);
      continue;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${expected.path}: workflow root must be an object`);
      continue;
    }
    values.set(expected.id, value);
    if (value?.name !== expected.name) errors.push(`${expected.path}: workflow name drift`);
    for (const [field, key] of [
      ["triggerDigest", "on"],
      ["permissionsDigest", "permissions"],
      ["concurrencyDigest", "concurrency"],
    ]) {
      const actualDigest = sectionDigest(value?.[key], expected.path, key, errors);
      if (actualDigest !== null && actualDigest !== expected[field])
        errors.push(`${expected.path}: ${key} contract drift`);
    }
    if (value.jobs === null || typeof value.jobs !== "object" || Array.isArray(value.jobs)) {
      errors.push(`${expected.path}: jobs must be an object`);
      continue;
    }
    let malformedJobs = false;
    for (const [id, job] of Object.entries(value.jobs)) {
      if (job === null || typeof job !== "object" || Array.isArray(job)) {
        errors.push(`${expected.path}: job ${id} must be an object`);
        malformedJobs = true;
        continue;
      }
      if (job.steps !== undefined && !Array.isArray(job.steps)) {
        errors.push(`${expected.path}: job ${id} steps must be an array`);
        malformedJobs = true;
      } else {
        for (const [index, step] of (job.steps ?? []).entries()) {
          if (step === null || typeof step !== "object" || Array.isArray(step)) {
            errors.push(`${expected.path}: job ${id} step ${index} must be an object`);
            malformedJobs = true;
          }
        }
      }
    }
    const jobs = Object.fromEntries(
      Object.entries(value.jobs).map(([id, job]) => [
        id,
        job !== null && typeof job === "object" ? (job.name ?? id) : id,
      ]),
    );
    if (JSON.stringify(jobs) !== JSON.stringify(expected.jobs)) errors.push(`${expected.path}: job/check name drift`);
    const jobsDigest = malformedJobs ? null : sectionDigest(value.jobs, expected.path, "jobs", errors);
    if (jobsDigest !== null && jobsDigest !== expected.jobsDigest) {
      errors.push(`${expected.path}: complete job contract drift`);
    }

    for (const action of workflowActions(value)) {
      const separator = action.lastIndexOf("@");
      const name = action.slice(0, separator);
      const version = action.slice(separator + 1);
      if (separator < 1 || version === "main" || version === "master" || version === "latest") {
        errors.push(`${expected.path}: mutable or malformed action reference: ${action}`);
      } else if (!(contract.actionVersions[name] ?? []).includes(version)) {
        errors.push(`${expected.path}: unapproved action version: ${action}`);
      }
    }
    for (const action of workflowLocalActions(value)) referencedLocalActions.add(action);
  }
  if (
    JSON.stringify([...referencedLocalActions].sort()) !== JSON.stringify(Object.keys(contract.localActions).sort())
  ) {
    errors.push("local action reference inventory drift");
  }

  const ci = values.get("ci");
  if (ci?.jobs?.ci?.name !== "ci" || ci?.jobs?.["external-tests"]?.name !== EXPECTED_REQUIRED_CONTEXTS[1]) {
    errors.push("ci workflow must preserve separate required Node and external Python checks");
  }

  const release = values.get("release-candidate-qualification");
  const releaseJob = release?.jobs?.qualify;
  const releaseSteps = Array.isArray(releaseJob?.steps) ? releaseJob.steps : [];
  if (JSON.stringify(Object.keys(release?.jobs ?? {})) !== JSON.stringify(["qualify"])) {
    errors.push("release qualification must contain exactly the single qualify job");
  }
  if (
    JSON.stringify(release?.permissions) !== JSON.stringify({ contents: "read" }) ||
    releaseJob?.permissions !== undefined
  ) {
    errors.push("release qualification permissions must remain exactly contents read with no job override");
  }
  const releaseActions = workflowActions({ jobs: { qualify: releaseJob } });
  const allowedReleaseActions = ["actions/checkout@v6", "hashicorp/setup-terraform@v4", "actions/upload-artifact@v4"];
  const localReleaseActions = releaseSteps
    .filter((step) => step !== null && typeof step === "object" && String(step.uses ?? "").startsWith("./"))
    .map((step) => step.uses);
  if (
    JSON.stringify(releaseActions) !== JSON.stringify(allowedReleaseActions) ||
    JSON.stringify(localReleaseActions) !==
      JSON.stringify(["./.github/actions/setup-node-repo", "./.github/actions/setup-python-validation"])
  ) {
    errors.push("release qualification contains an unapproved action");
  }
  const checkouts = releaseSteps.filter(
    (step) => step !== null && typeof step === "object" && String(step.uses ?? "").startsWith("actions/checkout@"),
  );
  const checkout = checkouts.find((step) => step.name === "Checkout exact candidate");
  if (
    checkouts.length !== 1 ||
    checkout?.uses !== "actions/checkout@v6" ||
    checkout.with?.ref !== "${{ github.event.pull_request.head.sha || github.sha }}" ||
    checkout.with?.["persist-credentials"] !== false
  ) {
    errors.push("release qualification must check out the exact candidate without persisted credentials");
  }
  const uploads = releaseSteps.filter(
    (step) =>
      step !== null && typeof step === "object" && String(step.uses ?? "").startsWith("actions/upload-artifact@"),
  );
  const upload = uploads.find((step) => step.name === "Upload compact qualification evidence");
  const expectedUploadPaths = [
    "dist/release-candidate/SHA256SUMS",
    "dist/release-candidate/receipt.json",
    "dist/release-candidate/logs/*.log",
    "dist/release-candidate/scorecard/evaluation.json",
    "dist/release-candidate/scorecard/evaluation.md",
    "dist/release-candidate/scorecard/measurements.json",
    "dist/release-candidate/scorecard/qualification.json",
  ];
  const actualUploadPaths = String(upload?.with?.path ?? "")
    .split(/\r?\n/u)
    .map((path) => path.trim())
    .filter(Boolean);
  if (
    uploads.length !== 1 ||
    upload?.uses !== "actions/upload-artifact@v4" ||
    upload.if !== "always()" ||
    upload.with?.name !== "release-qualification-${{ steps.candidate.outputs.candidate_sha }}" ||
    upload.with?.["if-no-files-found"] !== "error" ||
    upload.with?.["retention-days"] !== 30 ||
    JSON.stringify(actualUploadPaths) !== JSON.stringify(expectedUploadPaths)
  ) {
    errors.push("release qualification artifact version or retention drift");
  }
  if (containsForbiddenReleaseAuthority(workflowScripts(release))) {
    errors.push("release qualification contains forbidden mutation authority");
  }

  return errors;
}

function main() {
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const localActionTexts = loadLocalActionTexts(Object.keys(contract.localActions));
  const errors = validateGithubWorkflowContract({
    contract,
    schema,
    workflowTexts: loadWorkflowTexts(),
    localActionTexts,
  });
  process.exitCode = reportRegistryValidation({
    title: "GitHub Workflow Contract Validator",
    source: CONTRACT_PATH,
    errors,
    passMessage: "GitHub workflow contracts are valid",
    format: requestedReportFormat(process.argv.slice(2)),
  });
}

if (process.argv[1]?.endsWith("validate-github-workflows.mjs")) main();
