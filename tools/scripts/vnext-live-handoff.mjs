#!/usr/bin/env node
/** Dispatch and retrieve encrypted vNext live qualification authority handoffs. */

import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { isIPv4 } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { VNEXT_QUALIFICATION_REPOSITORY } from "./_lib/vnext-qualification.mjs";
import { EXPECTED_TAGS, validateQualificationSecurityException } from "./validate-vnext-qualification-context.mjs";

const execFile = promisify(execFileCallback);
const BRANCH = "main";
const WORKFLOW = "vnext-live-qualification.yml";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACKS = new Set(["bicep", "terraform"]);
const OPERATIONS = new Set(["apply", "destroy"]);
const STAGES = new Set(["apply", "preview-failure"]);
const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_CLI = join(SCRIPT_ROOT, "packages/cli/dist/cli.js");
const GOVERNANCE_FILE = join(SCRIPT_ROOT, "agent-output/vnext-qualification/04-governance-constraints.json");

export function canonicalRecipient(repository, runId, attempt, job) {
  if (!repository || !/^\d+$/.test(String(runId)) || attempt !== 1 || !["preview", "apply"].includes(job)) {
    throw new Error("Invalid canonical GitHub Actions recipient input");
  }
  return `github-actions:${repository}:${runId}:${attempt}:${job}`;
}

export function handoffRecipient(repository, handoffId) {
  if (!repository || !UUID_PATTERN.test(handoffId ?? "")) {
    throw new Error("Invalid GitHub Actions handoff recipient input");
  }
  return `github-actions:${repository}:handoff:${handoffId}:apply`;
}

export function workflowRef(repository, ref = BRANCH) {
  if (!repository || ref !== BRANCH) throw new Error(`Ref must be ${BRANCH}`);
  return `${repository}/.github/workflows/${WORKFLOW}@refs/heads/${ref}`;
}

export function validateTransportKey(value) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/.test(value)) {
    throw new Error("APEX_PLAN_TRANSPORT_KEY must be canonical base64 for exactly 32 bytes");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value) {
    throw new Error("APEX_PLAN_TRANSPORT_KEY must be canonical base64 for exactly 32 bytes");
  }
  return true;
}

export function validateDispatchRunState(status, track) {
  const run = status?.result?.run;
  if (run?.iacTool !== track) throw new Error("Selected APEX run does not match --track");
  const gate3 = run.gates?.find((gate) => gate.gate === 3);
  const gate4 = run.gates?.find((gate) => gate.gate === 4);
  if (!new Set(["approved", "inherited"]).has(gate3?.state)) {
    throw new Error("Selected APEX run requires approved Gate 3 before dispatch");
  }
  if (!new Set(["closed", "invalidated", "open", "approved", "rejected"]).has(gate4?.state)) {
    throw new Error("Selected APEX run has an unsupported Gate 4 state");
  }
  return true;
}

export function approvedDispatchState(status, approval, track, recipient, now = new Date()) {
  validateDispatchRunState(status, track);
  const run = status?.result?.run;
  const gate4 = run?.gates?.find((gate) => gate.gate === 4);
  const value = approval?.result;
  if (
    gate4?.state !== "approved" ||
    value?.gate !== 4 ||
    value?.decision !== "approved" ||
    value?.mechanism !== "tty" ||
    value?.writerEpoch !== run?.ownerEpoch ||
    value?.recipientIdentity !== recipient ||
    !/^[0-9a-f]{64}$/.test(value?.previewHash ?? "") ||
    !Number.isFinite(Date.parse(value?.expiresAt ?? "")) ||
    Date.parse(value.expiresAt) <= now.getTime() ||
    value?.writerTransferClaimHash !== undefined
  ) {
    throw new Error("Dispatch requires an approved local Gate 4 decision for the exact handoff recipient");
  }
  return value.previewHash;
}

export function isAcceptedLocalOwnership(ownership, recipient, head) {
  const value = ownership?.result;
  return (
    value?.ownerId === recipient &&
    value?.commit === head &&
    Number.isInteger(value?.ownerEpoch) &&
    /^[0-9a-f]{64}$/.test(value?.claimHash ?? "")
  );
}

export function validateWorkflowBootstrap(repository, defaultWorkflow, candidateWorkflow, localBlobSha) {
  const defaultBranch = repository?.defaultBranchRef?.name;
  if (typeof repository?.nameWithOwner !== "string" || typeof defaultBranch !== "string") {
    throw new Error("Repository default branch metadata is unavailable");
  }
  if (repository.nameWithOwner !== VNEXT_QUALIFICATION_REPOSITORY) {
    throw new Error(`Live qualification requires destination repository ${VNEXT_QUALIFICATION_REPOSITORY}`);
  }
  const expectedPath = `.github/workflows/${WORKFLOW}`;
  if (defaultWorkflow?.type !== "file" || defaultWorkflow?.path !== expectedPath) {
    throw new Error(`The live qualification workflow must be reviewed onto ${defaultBranch} before dispatch`);
  }
  if (candidateWorkflow?.type !== "file" || candidateWorkflow?.path !== expectedPath) {
    throw new Error(`The live qualification workflow must exist on ${BRANCH} before dispatch`);
  }
  if (
    !/^[0-9a-f]{40}$/.test(localBlobSha ?? "") ||
    defaultWorkflow.sha !== localBlobSha ||
    candidateWorkflow.sha !== localBlobSha
  ) {
    throw new Error("Default, candidate, and local live qualification workflows must be byte-identical");
  }
  return { repository: repository.nameWithOwner, defaultBranch };
}

export function parseArgs(argv) {
  const command = argv[0];
  if (!new Set(["preview", "dispatch", "retrieve"]).has(command)) {
    throw new Error("Expected preview, dispatch, or retrieve subcommand");
  }
  const values = { command };
  for (let index = 1; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name?.startsWith("--")) throw new Error(`Unexpected argument: ${name ?? "<missing>"}`);
    const key = name.slice(2).replaceAll("-", "_");
    if (Object.hasOwn(values, key)) throw new Error(`Duplicate argument: ${name}`);
    if (key === "yes") values.yes = true;
    else {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
      values[key] = value;
    }
  }
  const common = new Set(["yes", "track", "operation", "resource_group", "storage_account", "container"]);
  const allowed =
    command === "preview"
      ? new Set([...common, "handoff_id"])
      : command === "dispatch"
        ? new Set([...common, "ref", "handoff_id"])
        : new Set([...common, "handoff_id", "destination", "stage"]);
  for (const key of Object.keys(values)) {
    if (key !== "command" && !allowed.has(key)) throw new Error(`Unknown argument: --${key.replaceAll("_", "-")}`);
  }
  if (values.yes !== true) throw new Error(`${command} requires --yes`);
  for (const key of ["track", "operation", "resource_group", "storage_account"]) {
    if (typeof values[key] !== "string") throw new Error(`Missing --${key.replaceAll("_", "-")}`);
  }
  if (!TRACKS.has(values.track)) throw new Error("--track must be bicep or terraform");
  if (!OPERATIONS.has(values.operation)) throw new Error("--operation must be apply or destroy");
  values.container ??= "handoff";
  if (command === "preview") {
    if (values.handoff_id !== undefined && !UUID_PATTERN.test(values.handoff_id)) {
      throw new Error("--handoff-id must be a UUID");
    }
  } else if (command === "dispatch") {
    if (values.ref !== BRANCH) throw new Error(`--ref must be ${BRANCH}`);
    if (typeof values.handoff_id !== "string" || !UUID_PATTERN.test(values.handoff_id)) {
      throw new Error("dispatch requires --handoff-id UUID from the approved local preview");
    }
  } else {
    for (const key of ["handoff_id", "destination"]) {
      if (typeof values[key] !== "string") throw new Error(`Missing --${key.replaceAll("_", "-")}`);
    }
    if (!UUID_PATTERN.test(values.handoff_id)) throw new Error("--handoff-id must be a UUID");
    values.stage ??= "apply";
    if (!STAGES.has(values.stage)) throw new Error("--stage must be apply or preview-failure");
    if (!isAbsolute(values.destination)) throw new Error("--destination must be an absolute path");
  }
  return values;
}

function safeError(message, context = {}) {
  const suffix = Object.entries(context)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return new Error(suffix ? `${message} (${suffix})` : message);
}

async function run(file, args, options = {}) {
  try {
    const result = await execFile(file, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: options.timeout ?? 60_000,
    });
    return result.stdout.trim();
  } catch {
    throw safeError(`Command failed: ${basename(file)}`);
  }
}

async function json(file, args, options) {
  const output = await run(file, args, options);
  try {
    return JSON.parse(output);
  } catch {
    throw safeError(`Command returned invalid JSON: ${basename(file)}`);
  }
}

export function validateGitStatus(status, allowApexState = false) {
  const changes = status.split("\n").filter(Boolean);
  if (
    changes.length > 0 &&
    (!allowApexState ||
      changes.some((change) => {
        const path = change.slice(3);
        return !path.startsWith(".apex/") || path.includes(" -> ");
      }))
  ) {
    throw new Error("Checkout contains changes outside the permitted APEX state boundary");
  }
}

async function gitState(directory, allowApexState = false) {
  const head = await run("git", ["rev-parse", "HEAD"], { cwd: directory });
  const branch = await run("git", ["branch", "--show-current"], { cwd: directory });
  const status = await run("git", ["status", "--porcelain"], { cwd: directory });
  if (!SHA_PATTERN.test(head)) throw new Error("Checkout must be at an exact lowercase commit");
  validateGitStatus(status, allowApexState);
  return { head, branch };
}

async function publicIpv4(fetchImpl = fetch) {
  const response = await fetchImpl("https://api.ipify.org", { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Public IPv4 lookup failed");
  const address = (await response.text()).trim();
  if (!isIPv4(address)) throw new Error("Public endpoint did not return an IPv4 address");
  return address;
}

export async function withFirewall(args, action, dependencies = {}) {
  const validateException =
    dependencies.validateException ?? (() => validateQualificationSecurityException(GOVERNANCE_FILE));
  const resolvePublicIpv4 = dependencies.publicIpv4 ?? publicIpv4;
  const runCommand = dependencies.run ?? run;
  const assertException = () => {
    const exceptionIssues = validateException();
    if (exceptionIssues.length > 0) {
      throw safeError("Qualification firewall exception is invalid", { issues: exceptionIssues.join("; ") });
    }
  };
  assertException();
  const address = await resolvePublicIpv4();
  assertException();
  const common = [
    "--resource-group",
    args.resource_group,
    "--account-name",
    args.storage_account,
    "--ip-address",
    `${address}/32`,
    "--only-show-errors",
    "--output",
    "none",
  ];
  let operationResult;
  let operationFailure;
  let cleanupFailure;
  try {
    await runCommand("az", [
      "storage",
      "account",
      "update",
      "--resource-group",
      args.resource_group,
      "--name",
      args.storage_account,
      "--set",
      "tags.SecurityControl=Ignore",
      "--only-show-errors",
      "--output",
      "none",
    ]);
    await runCommand("az", [
      "storage",
      "account",
      "update",
      "--resource-group",
      args.resource_group,
      "--name",
      args.storage_account,
      "--public-network-access",
      "Enabled",
      "--only-show-errors",
      "--output",
      "none",
    ]);
    await runCommand("az", ["storage", "account", "network-rule", "add", ...common]);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await runCommand("az", [
          "storage",
          "blob",
          "list",
          "--auth-mode",
          "login",
          "--account-name",
          args.storage_account,
          "--container-name",
          args.container,
          "--num-results",
          "1",
          "--only-show-errors",
          "--output",
          "none",
        ]);
        break;
      } catch {
        if (attempt === 5) throw new Error("Storage data-plane access did not become ready");
        await new Promise((resolveTimer) => setTimeout(resolveTimer, attempt * 5_000));
      }
    }
    operationResult = await action();
  } catch (error) {
    operationFailure = error;
  } finally {
    let removalFailed = false;
    try {
      await runCommand("az", ["storage", "account", "network-rule", "remove", ...common]);
    } catch {
      removalFailed = true;
    }
    let disableFailed = false;
    try {
      await runCommand("az", [
        "storage",
        "account",
        "update",
        "--resource-group",
        args.resource_group,
        "--name",
        args.storage_account,
        "--public-network-access",
        "Disabled",
        "--only-show-errors",
        "--output",
        "none",
      ]);
    } catch {
      disableFailed = true;
    }
    let exclusionRemovalFailed = false;
    try {
      await runCommand("az", [
        "storage",
        "account",
        "update",
        "--resource-group",
        args.resource_group,
        "--name",
        args.storage_account,
        "--remove",
        "tags.SecurityControl",
        "--only-show-errors",
        "--output",
        "none",
      ]);
    } catch {
      exclusionRemovalFailed = true;
    }
    let verificationFailed;
    try {
      const endpointState = JSON.parse(
        await runCommand("az", [
          "storage",
          "account",
          "show",
          "--resource-group",
          args.resource_group,
          "--name",
          args.storage_account,
          "--query",
          "{publicNetworkAccess:publicNetworkAccess,securityControl:tags.SecurityControl}",
          "--output",
          "json",
        ]),
      );
      verificationFailed = endpointState?.publicNetworkAccess !== "Disabled" || endpointState?.securityControl != null;
    } catch {
      verificationFailed = true;
    }
    if (removalFailed || disableFailed || exclusionRemovalFailed || verificationFailed) {
      cleanupFailure = safeError("Qualification firewall cleanup failed", {
        removalFailed,
        disableFailed,
        exclusionRemovalFailed,
        verificationFailed,
      });
    }
  }
  if (cleanupFailure) throw cleanupFailure;
  if (operationFailure) throw operationFailure;
  return operationResult;
}

async function discoverRun(handoffId, candidateSha) {
  const title = `vnext-live-`;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const runs = await json("gh", [
      "run",
      "list",
      "--workflow",
      WORKFLOW,
      "--branch",
      BRANCH,
      "--limit",
      "30",
      "--json",
      "databaseId,displayTitle,headSha,headBranch,url",
    ]);
    const match = runs.find(
      (run) =>
        run.displayTitle.startsWith(title) && run.displayTitle.endsWith(handoffId) && run.headSha === candidateSha,
    );
    if (match) return match;
    await new Promise((resolveTimer) => setTimeout(resolveTimer, Math.min(2_000 * (attempt + 1), 10_000)));
  }
  throw new Error("Dispatched workflow run was not discoverable within the retry window");
}

async function localProviderConfig(args, temporary, account) {
  const workspace =
    `/subscriptions/${account.id}/resourceGroups/${args.resource_group}/` +
    "providers/Microsoft.OperationalInsights/workspaces/log-vnext-qualification";
  const environment = {
    ...process.env,
    AZURE_SUBSCRIPTION_ID: account.id,
    APEX_PROJECT_NAME: "vnext",
    APEX_LOCATION: "swedencentral",
    APEX_CONTROL_RESOURCE_GROUP: args.resource_group,
    APEX_BICEP_RESOURCE_GROUP: "rg-vnext-qualification-bicep",
    APEX_TERRAFORM_RESOURCE_GROUP: "rg-vnext-qualification-terraform",
    APEX_BACKEND_STORAGE_ACCOUNT: args.storage_account,
    APEX_LOG_ANALYTICS_WORKSPACE_RESOURCE_ID: workspace,
    APEX_QUALIFICATION_TAGS_JSON: JSON.stringify(EXPECTED_TAGS),
  };
  await run("node", ["tools/scripts/validate-vnext-qualification-context.mjs"], {
    cwd: SCRIPT_ROOT,
    env: environment,
  });
  const providerConfig = join(temporary, "provider-config.json");
  if (args.track === "bicep") {
    const parametersFile = join(temporary, "main.parameters.json");
    await writeFile(
      parametersFile,
      `${JSON.stringify(
        {
          $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
          contentVersion: "1.0.0.0",
          parameters: {
            projectName: { value: "vnext" },
            environment: { value: "qualification" },
            location: { value: "swedencentral" },
            tags: { value: EXPECTED_TAGS },
            logAnalyticsWorkspaceResourceId: { value: workspace },
          },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      providerConfig,
      `${JSON.stringify(
        {
          bicep: {
            resourceGroup: "rg-vnext-qualification-bicep",
            deploymentName: "vnext-qualification",
            stackName: "vnext-qualification",
            templateFile: join(SCRIPT_ROOT, "infra/bicep/vnext-qualification/main.bicep"),
            parametersFile,
            actionOnUnmanage: "deleteResources",
            ownershipAuthorizesDeleteResources: true,
            dedicatedSandboxResourceGroup: true,
            denySettingsMode: "denyDelete",
          },
        },
        null,
        2,
      )}\n`,
    );
    return { providerConfig, environment };
  }
  const terraformRoot = join(SCRIPT_ROOT, "infra/terraform/vnext-qualification");
  const backendFile = join(temporary, "backend.hcl");
  const planDirectory = join(temporary, "plans");
  await mkdir(planDirectory, { recursive: true });
  await writeFile(
    backendFile,
    [
      `resource_group_name = "${args.resource_group}"`,
      `storage_account_name = "${args.storage_account}"`,
      'container_name = "tfstate"',
      'key = "vnext-qualification.tfstate"',
      "use_cli = true",
      "use_oidc = false",
      "use_azuread_auth = true",
      "",
    ].join("\n"),
  );
  const lockOutput = await run("sha256sum", [join(terraformRoot, ".terraform.lock.hcl")]);
  const lockfileHash = lockOutput.split(/\s+/, 1)[0];
  await writeFile(
    providerConfig,
    `${JSON.stringify(
      {
        terraform: {
          cwd: terraformRoot,
          target: "rg-vnext-qualification-terraform",
          planDirectory,
          lockfileHash,
        },
      },
      null,
      2,
    )}\n`,
  );
  for (const name of ["ARM_CLIENT_ID", "ARM_OIDC_TOKEN", "ARM_TENANT_ID"]) delete environment[name];
  Object.assign(environment, {
    ARM_SUBSCRIPTION_ID: account.id,
    ARM_USE_AZUREAD: "true",
    ARM_USE_CLI: "true",
    ARM_USE_OIDC: "false",
    TF_CLI_ARGS_init: `-backend-config=${backendFile}`,
    TF_VAR_project_name: "vnext",
    TF_VAR_environment: "qualification",
    TF_VAR_location: "swedencentral",
    TF_VAR_resource_group_name: "rg-vnext-qualification-terraform",
    TF_VAR_log_analytics_workspace_resource_id: workspace,
    TF_VAR_tags: JSON.stringify(EXPECTED_TAGS),
  });
  return { providerConfig, environment };
}

async function preview(args) {
  validateTransportKey(process.env.APEX_PLAN_TRANSPORT_KEY);
  const checkout = await gitState(process.cwd());
  if (checkout.branch !== BRANCH) throw new Error(`Checkout must be ${BRANCH}`);
  validateDispatchRunState(await json("node", [SOURCE_CLI, "status", "--json"]), args.track);
  await run("az", ["account", "get-access-token", "--resource", "https://management.azure.com/", "--output", "none"]);
  const repositoryMetadata = await json("gh", ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]);
  if (repositoryMetadata.nameWithOwner !== VNEXT_QUALIFICATION_REPOSITORY) {
    throw new Error(`Live qualification requires destination repository ${VNEXT_QUALIFICATION_REPOSITORY}`);
  }
  const handoffId = args.handoff_id ?? randomUUID();
  const recipient = handoffRecipient(repositoryMetadata.nameWithOwner, handoffId);
  const temporary = await mkdtemp(join(tmpdir(), "apex-vnext-preview-"));
  const persistedProviderConfig = join(process.cwd(), ".apex", "provider-config.json");
  let previousProviderConfig;
  try {
    try {
      previousProviderConfig = await readFile(persistedProviderConfig);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const account = await json("az", ["account", "show", "--query", "{id:id,tenantId:tenantId}", "--output", "json"]);
    const config = await localProviderConfig(args, temporary, account);
    const action = () =>
      json(
        "node",
        [
          SOURCE_CLI,
          "preview",
          "--operation",
          args.operation,
          "--provider",
          args.track,
          "--recipient",
          recipient,
          "--provider-config",
          config.providerConfig,
          "--json",
        ],
        { cwd: process.cwd(), env: config.environment, timeout: 20 * 60_000 },
      );
    const created = args.track === "terraform" ? await withFirewall(args, action) : await action();
    const rendered = await json("node", [SOURCE_CLI, "render", "--kind", "preview", "--json"]);
    return {
      command: "preview",
      handoffId,
      recipient,
      candidateSha: checkout.head,
      previewHash: created.result.previewHash,
      preview: rendered.result,
      approvalCommand:
        `node packages/cli/dist/cli.js gate decide --gate 4 --decision approved ` +
        `--actor <maintainer> --recipient ${recipient} --json`,
    };
  } finally {
    if (previousProviderConfig === undefined) await rm(persistedProviderConfig, { force: true });
    else await writeFile(persistedProviderConfig, previousProviderConfig);
    await rm(temporary, { recursive: true, force: true });
  }
}

async function dispatch(args) {
  validateTransportKey(process.env.APEX_PLAN_TRANSPORT_KEY);
  const checkout = await gitState(process.cwd(), true);
  if (checkout.branch !== BRANCH || args.ref !== BRANCH) throw new Error(`Checkout and --ref must be ${BRANCH}`);
  const status = await json("node", [SOURCE_CLI, "status", "--json"]);
  await run("az", ["account", "get-access-token", "--resource", "https://management.azure.com/", "--output", "none"]);
  const repositoryMetadata = await json("gh", ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]);
  const defaultBranch = repositoryMetadata.defaultBranchRef?.name;
  const defaultWorkflow = await json("gh", [
    "api",
    "-X",
    "GET",
    `repos/${repositoryMetadata.nameWithOwner}/contents/.github/workflows/${WORKFLOW}`,
    "-f",
    `ref=${defaultBranch}`,
  ]);
  const candidateWorkflow = await json("gh", [
    "api",
    "-X",
    "GET",
    `repos/${repositoryMetadata.nameWithOwner}/contents/.github/workflows/${WORKFLOW}`,
    "-f",
    `ref=${BRANCH}`,
  ]);
  const localBlobSha = await run("git", ["hash-object", `.github/workflows/${WORKFLOW}`]);
  const { repository } = validateWorkflowBootstrap(
    repositoryMetadata,
    defaultWorkflow,
    candidateWorkflow,
    localBlobSha,
  );
  const recipient = handoffRecipient(repository, args.handoff_id);
  const approval = await json("node", [SOURCE_CLI, "approval", "show", "--json"]);
  const previewHash = approvedDispatchState(status, approval, args.track, recipient);
  await withFirewall(args, async () => undefined);
  const handoffId = args.handoff_id;
  await run("gh", [
    "workflow",
    "run",
    WORKFLOW,
    "--ref",
    args.ref,
    "-f",
    `track=${args.track}`,
    "-f",
    `operation=${args.operation}`,
    "-f",
    `handoff_id=${handoffId}`,
    "-f",
    `candidate_sha=${checkout.head}`,
    "-f",
    `preview_hash=${previewHash}`,
  ]);
  const runSummary = await discoverRun(handoffId, checkout.head);
  const details = await json("gh", ["api", `repos/${repository}/actions/runs/${runSummary.databaseId}`]);
  if (details.run_attempt !== 1 || details.head_branch !== BRANCH || details.head_sha !== checkout.head) {
    throw safeError("Dispatched run binding verification failed", { runId: runSummary.databaseId, handoffId });
  }
  const temporary = await mkdtemp(join(tmpdir(), "apex-vnext-handoff-"));
  const stateEnvelope = join(temporary, "state.json");
  const providerEnvelope = join(temporary, "provider.json");
  let claimHash;
  try {
    const shown = await json("node", [SOURCE_CLI, "writer", "show", "--json"]);
    const sender = shown.result?.ownerId ?? "local";
    const claim = await json("node", [
      SOURCE_CLI,
      "writer",
      "transfer-create",
      "--repo",
      repository,
      "--branch",
      BRANCH,
      "--commit",
      checkout.head,
      "--workflow",
      workflowRef(repository),
      "--sender",
      sender,
      "--recipient",
      recipient,
      "--head",
      checkout.head,
      "--ttl",
      "7200000",
      "--json",
    ]);
    claimHash = claim.result.hash;
    await json("node", [
      SOURCE_CLI,
      "state",
      "transfer-export",
      "--claim",
      claimHash,
      "--recipient",
      recipient,
      "--ttl-seconds",
      "3600",
      "--file",
      stateEnvelope,
      "--yes",
      "--json",
    ]);
    await json("node", [
      SOURCE_CLI,
      "provider",
      "transfer-export",
      "--preview",
      previewHash,
      "--provider",
      args.track,
      "--recipient",
      recipient,
      "--ttl-seconds",
      "3600",
      "--file",
      providerEnvelope,
      "--yes",
      "--json",
    ]);
    await Promise.all([chmod(stateEnvelope, 0o600), chmod(providerEnvelope, 0o600)]);
    await withFirewall(args, async () => {
      for (const [name, file] of [
        [`incoming/${handoffId}/state.json`, stateEnvelope],
        [`incoming/${handoffId}/provider.json`, providerEnvelope],
      ]) {
        await run("az", [
          "storage",
          "blob",
          "upload",
          "--auth-mode",
          "login",
          "--account-name",
          args.storage_account,
          "--container-name",
          args.container,
          "--name",
          name,
          "--file",
          file,
          "--overwrite",
          "false",
          "--only-show-errors",
          "--output",
          "none",
        ]);
      }
    });
  } catch {
    throw safeError("Encrypted handoff preparation failed after dispatch", {
      runId: runSummary.databaseId,
      handoffId,
      ...(claimHash === undefined ? {} : { claimHash }),
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return {
    command: "dispatch",
    handoffId,
    runId: runSummary.databaseId,
    runUrl: runSummary.url,
    candidateSha: checkout.head,
    previewHash,
    recipient,
    instruction: `The workflow will import the existing local Gate 4 approval and cannot create approval.`,
  };
}

async function assertDestination(destination) {
  const info = await stat(destination);
  if (!info.isDirectory()) throw new Error("Destination must be a directory");
  const checkout = await gitState(destination);
  if (checkout.branch !== BRANCH) throw new Error(`Destination branch must be ${BRANCH}`);
  return checkout;
}

async function currentOwnership(destination) {
  try {
    await stat(join(destination, ".apex", "config.json"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return await json("node", [SOURCE_CLI, "writer", "show", "--json"], { cwd: destination });
}

async function deleteReturnBlob(args, blob) {
  const exists = await json("az", [
    "storage",
    "blob",
    "exists",
    "--auth-mode",
    "login",
    "--account-name",
    args.storage_account,
    "--container-name",
    args.container,
    "--name",
    blob,
    "--only-show-errors",
    "--output",
    "json",
  ]);
  if (exists.exists !== true) return;
  await run("az", [
    "storage",
    "blob",
    "delete",
    "--auth-mode",
    "login",
    "--account-name",
    args.storage_account,
    "--container-name",
    args.container,
    "--name",
    blob,
    "--only-show-errors",
    "--output",
    "none",
  ]);
}

async function retrieve(args) {
  validateTransportKey(process.env.APEX_PLAN_TRANSPORT_KEY);
  const destination = resolve(args.destination);
  const checkout = await assertDestination(destination);
  const suffix = args.stage === "apply" ? "" : "-preview-failure";
  const blob = `return/${args.handoff_id}/${args.track}-${args.operation}${suffix}.json`;
  const artifact = `vnext-return-${args.handoff_id}-${args.track}-${args.operation}-${args.stage}`;
  const temporary = await mkdtemp(join(tmpdir(), "apex-vnext-return-"));
  const envelope = join(temporary, "return.json");
  const recipient = `local:${args.handoff_id}`;
  try {
    const ownership = await currentOwnership(destination);
    if (isAcceptedLocalOwnership(ownership, recipient, checkout.head)) {
      await withFirewall(args, () => deleteReturnBlob(args, blob));
      return {
        command: "retrieve",
        handoffId: args.handoff_id,
        destination,
        candidateSha: checkout.head,
        stage: args.stage,
        idempotent: true,
      };
    }
    try {
      await withFirewall(args, () =>
        run("az", [
          "storage",
          "blob",
          "download",
          "--auth-mode",
          "login",
          "--account-name",
          args.storage_account,
          "--container-name",
          args.container,
          "--name",
          blob,
          "--file",
          envelope,
          "--overwrite",
          "true",
          "--only-show-errors",
          "--output",
          "none",
        ]),
      );
    } catch {
      throw new Error(`Return blob is unavailable. Download the exact fallback artifact named ${artifact}.`);
    }
    await chmod(envelope, 0o600);
    const imported = await json(
      "node",
      [SOURCE_CLI, "state", "transfer-import", "--file", envelope, "--recipient", recipient, "--yes", "--json"],
      { cwd: destination },
    );
    await json(
      "node",
      [
        SOURCE_CLI,
        "writer",
        "transfer-accept",
        "--claim",
        imported.result.claimHash,
        "--recipient",
        recipient,
        "--head",
        checkout.head,
        "--json",
      ],
      { cwd: destination },
    );
    await withFirewall(args, () => deleteReturnBlob(args, blob));
    return {
      command: "retrieve",
      handoffId: args.handoff_id,
      destination,
      candidateSha: checkout.head,
      stage: args.stage,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result =
      args.command === "preview"
        ? await preview(args)
        : args.command === "dispatch"
          ? await dispatch(args)
          : await retrieve(args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "vNext handoff failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
