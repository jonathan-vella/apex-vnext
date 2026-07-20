#!/usr/bin/env node
/** Validate the manual vNext live qualification workflow security contract. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { VNEXT_QUALIFICATION_REPOSITORY } from "./_lib/vnext-qualification.mjs";

const WORKFLOW = ".github/workflows/vnext-live-qualification.yml";
const PROTECTED = ["apply"];
const REQUIRED_VARS = [
  "APEX_CONTROL_RESOURCE_GROUP",
  "APEX_BACKEND_STORAGE_ACCOUNT",
  "APEX_BICEP_RESOURCE_GROUP",
  "APEX_TERRAFORM_RESOURCE_GROUP",
  "APEX_LOG_ANALYTICS_WORKSPACE_RESOURCE_ID",
  "APEX_LOCATION",
  "APEX_PROJECT_NAME",
  "APEX_QUALIFICATION_TAGS_JSON",
];

const steps = (job) => (Array.isArray(job?.steps) ? job.steps : []);
const runs = (job) =>
  steps(job)
    .map((step) => step.run ?? "")
    .join("\n");
const uses = (job) =>
  steps(job)
    .map((step) => step.uses)
    .filter(Boolean);
const index = (text, value) => text.indexOf(value);
const hasExactPermissions = (permissions, expected) =>
  permissions &&
  Object.keys(permissions).length === Object.keys(expected).length &&
  Object.entries(expected).every(([name, access]) => permissions[name] === access);
const hasHiddenPathSegment = (paths) =>
  String(paths)
    .split(/\r?\n/)
    .some((path) =>
      path
        .trim()
        .split(/[\\/]/)
        .some((segment) => segment.startsWith(".") && segment !== "." && segment !== ".."),
    );

export function validateWorkflowText(text) {
  const errors = [];
  let value;
  try {
    value = yaml.load(text);
  } catch (error) {
    return [`YAML parse failed: ${error.message}`];
  }
  const fail = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const triggers = value?.on;
  fail(triggers && Object.keys(triggers).length === 1 && triggers.workflow_dispatch, "workflow must be dispatch-only");
  const inputs = triggers?.workflow_dispatch?.inputs ?? {};
  fail(
    Object.keys(inputs).join() === "track,operation,handoff_id,candidate_sha,preview_hash",
    "exact dispatch input set required",
  );
  fail(inputs.track?.type === "choice" && inputs.track.options?.join() === "bicep,terraform", "track choices invalid");
  fail(
    inputs.operation?.type === "choice" && inputs.operation.options?.join() === "apply,destroy",
    "operation choices invalid",
  );
  fail(
    inputs.track?.required === true &&
      inputs.operation?.required === true &&
      inputs.handoff_id?.required === true &&
      inputs.candidate_sha?.required === true &&
      inputs.preview_hash?.required === true,
    "required dispatch inputs missing",
  );
  fail(
    hasExactPermissions(value?.permissions, { contents: "read" }),
    "workflow permissions must be contents read only",
  );
  fail(value?.concurrency?.["cancel-in-progress"] === false, "authority ceremony must not be cancelled in progress");
  const jobs = value?.jobs ?? {};
  fail(Object.keys(jobs).join() === "validate_dispatch,apply", "exact validate_dispatch and apply jobs required");
  fail(
    hasExactPermissions(jobs.validate_dispatch?.permissions, { contents: "read" }),
    "validate_dispatch permissions must be contents read only",
  );
  fail(jobs.validate_dispatch?.["runs-on"] === "ubuntu-latest", "validate_dispatch runner must be ubuntu-latest");
  fail(jobs.apply?.needs === "validate_dispatch", "apply must need validate_dispatch");
  fail(jobs.apply?.if === undefined, "apply must not bypass dispatch validation");
  for (const name of ["validate_dispatch", ...PROTECTED]) {
    const checkoutSteps = steps(jobs[name]).filter((step) => step.uses === "actions/checkout@v6");
    fail(
      checkoutSteps.length === 1 &&
        checkoutSteps[0].with?.ref === "${{ inputs.candidate_sha }}" &&
        checkoutSteps[0].with?.["persist-credentials"] === false,
      `${name} checkout must use candidate SHA with persisted credentials disabled`,
    );
  }
  const validation = runs(jobs.validate_dispatch);
  fail(
    validation.includes(`test "$GITHUB_REPOSITORY" = "${VNEXT_QUALIFICATION_REPOSITORY}"`),
    "destination repository guard missing",
  );
  fail(validation.includes("refs/heads/main"), "branch guard missing");
  fail(validation.includes('GITHUB_RUN_ATTEMPT" = "1'), "attempt-one guard missing");
  fail(
    validation.includes("^[0-9a-f]{40}$") &&
      validation.includes("^[0-9a-f]{64}$") &&
      validation.includes("git rev-parse HEAD"),
    "exact lowercase SHA or preview hash guard missing",
  );
  fail(validation.includes("[0-9a-f]{8}-[0-9a-f]{4}-4"), "handoff UUID guard missing");
  fail(uses(jobs.validate_dispatch).includes("actions/checkout@v6"), "validation checkout must use v6");
  fail(!text.includes("APEX_PLAN_TRANSPORT_KEY"), "manual transport key is forbidden");

  for (const name of PROTECTED) {
    const job = jobs[name];
    const script = runs(job);
    const actions = uses(job);
    fail(!script.includes("network-rule add") && !script.includes("network-rule remove"), `${name} IP rules forbidden`);
    fail(
      hasExactPermissions(job?.permissions, { contents: "read", "id-token": "write" }),
      `${name} permissions must be contents read and id-token write only`,
    );
    fail(job?.environment === "vnext-qualification", `${name} environment missing`);
    fail(job?.["runs-on"] === "ubuntu-latest", `${name} runner must be ubuntu-latest`);
    fail(job?.env?.ARM_OIDC_TOKEN === undefined, `${name} ARM token must not be job-wide`);
    fail(
      job?.env?.APEX_RUNTIME_ROOT === "${{ github.workspace }}/apex-live/runtime",
      `${name} isolated APEX runtime missing`,
    );
    fail(job?.["timeout-minutes"] > 0, `${name} timeout missing`);
    fail(actions.includes("actions/checkout@v6"), `${name} exact checkout action missing`);
    fail(actions.includes("./.github/actions/setup-node-repo"), `${name} setup action missing`);
    fail(actions.includes("azure/login@v3"), `${name} Azure login version invalid`);
    fail(actions.includes("hashicorp/setup-terraform@v3"), `${name} Terraform setup version invalid`);
    fail(actions.includes("actions/github-script@v9"), `${name} OIDC script version invalid`);
    fail(script.includes("git rev-parse HEAD"), `${name} does not verify checked out HEAD`);
    const atRest = steps(job).find((step) => step.name === "Validate at-rest endpoint boundary");
    fail(
      atRest?.run?.includes("publicNetworkAccess") &&
        atRest.run.includes("networkRuleSet.defaultAction") &&
        atRest.run.includes("networkRuleSet.ipRules") &&
        atRest.run.includes("allowSharedKeyAccess") &&
        atRest.run.includes("allowBlobPublicAccess") &&
        atRest.run.includes("defaultToOAuthAuthentication"),
      `${name} at-rest endpoint validation missing`,
    );
    const firewallOpen = steps(job).find((step) => step.name === "Open temporary Entra-only endpoint session");
    const firewallOpenScript = firewallOpen?.run ?? "";
    fail(
      firewallOpenScript.includes("--security-exception-only") &&
        index(firewallOpenScript, "--security-exception-only") <
          index(firewallOpenScript, "--set tags.SecurityControl=Ignore") &&
        index(firewallOpenScript, "--set tags.SecurityControl=Ignore") <
          index(firewallOpenScript, "--public-network-access Enabled") &&
        index(firewallOpenScript, "--public-network-access Enabled") <
          index(firewallOpenScript, "--default-action Allow"),
      `${name} firewall boundary transaction missing`,
    );
    fail(
      script.includes("storage blob list") && script.includes("for attempt in 1 2 3 4 5"),
      `${name} data-plane readiness probe missing`,
    );
    fail(
      script.includes("sha256sum infra/terraform/vnext-qualification/.terraform.lock.hcl") &&
        script.includes('= "$attested_lock_hash"'),
      `${name} exact Terraform lockfile binding missing`,
    );
    const cleanup = steps(job).find((step) => step.name === "Close temporary Entra-only endpoint session");
    fail(
      cleanup?.if === "always()" &&
        cleanup.run?.includes("--default-action Deny") &&
        cleanup.run?.includes("--public-network-access Disabled") &&
        cleanup.run?.includes("--remove tags.SecurityControl") &&
        cleanup.run?.includes("defaultAction:networkRuleSet.defaultAction") &&
        cleanup.run?.includes("securityControl:tags.SecurityControl") &&
        cleanup.run?.includes('!= "Disabled"') &&
        cleanup.run?.includes('!= "Deny"') &&
        cleanup.run?.includes('-n "$security_control"'),
      `${name} unconditional cleanup missing`,
    );
    fail(
      script.includes("session:$session") && script.includes("restored:$restored") && script.includes('exit "$status"'),
      `${name} cleanup evidence/failure missing`,
    );
    for (const variable of REQUIRED_VARS) fail(script.includes(variable), `${name} does not validate ${variable}`);
    fail(
      script
        .split(/\r?\n/)
        .some((line) => line.trim() === "node tools/scripts/validate-vnext-qualification-context.mjs") &&
        script.includes("az account show --query id") &&
        script.includes('= "$AZURE_SUBSCRIPTION_ID"'),
      `${name} exact qualification context validation missing`,
    );
    const jobSteps = steps(job);
    const qualificationValidationIndex = jobSteps.findIndex((step) =>
      step.run
        ?.split(/\r?\n/)
        .some((line) => line.trim() === "node tools/scripts/validate-vnext-qualification-context.mjs"),
    );
    const firewallAddIndex = jobSteps.findIndex((step) => step.name === "Open temporary Entra-only endpoint session");
    fail(
      qualificationValidationIndex >= 0 && firewallAddIndex > qualificationValidationIndex,
      `${name} security exception validation must precede endpoint opening`,
    );
    const protectedInputs = steps(job).find((step) => step.name === "Validate protected inputs");
    fail(
      protectedInputs?.env?.AZURE_SUBSCRIPTION_ID === "${{ secrets.AZURE_SUBSCRIPTION_ID }}",
      `${name} subscription validation secret missing`,
    );
    const oidc = steps(job).find((step) => step.name === "Acquire ARM OIDC token");
    fail(
      oidc?.id === "arm_oidc" &&
        oidc.uses === "actions/github-script@v9" &&
        oidc.with?.["result-encoding"] === "string" &&
        oidc.with?.script?.includes("return token") &&
        !oidc.with?.script?.includes("exportVariable"),
      `${name} ARM token must be a masked step output`,
    );
    const refreshedOidc = steps(job).find((step) => step.name === "Refresh ARM OIDC token for deploy");
    const refreshedId = "deploy_oidc";
    fail(
      refreshedOidc?.id === refreshedId &&
        refreshedOidc.uses === "actions/github-script@v9" &&
        refreshedOidc.with?.["result-encoding"] === "string" &&
        refreshedOidc.with?.script?.includes("return token"),
      `${name} refreshed ARM token step missing`,
    );
    for (const step of steps(job)) {
      const command = step.run ?? "";
      if (/terraform -chdir=|\bdeploy --preview\b/.test(command)) {
        const expectedToken =
          step.name === "Deploy exact preview"
            ? "${{ steps.deploy_oidc.outputs.result }}"
            : "${{ steps.arm_oidc.outputs.result }}";
        fail(step.env?.ARM_OIDC_TOKEN === expectedToken, `${name} Terraform operation lacks step-scoped ARM token`);
      }
    }
  }

  const apply = runs(jobs.apply);
  const applyJob = JSON.stringify(jobs.apply);
  const applySteps = steps(jobs.apply);
  const stableRecipient = 'apply_recipient="github-actions:${GITHUB_REPOSITORY}:handoff:${HANDOFF_ID}:apply"';
  fail(apply.includes(stableRecipient), "stable handoff apply recipient missing");
  fail(
    !apply.includes("GITHUB_RUN_ID") && !apply.includes("GITHUB_RUN_ATTEMPT}:apply"),
    "run-scoped recipient forbidden",
  );
  const stateBlob = "incoming/${{ inputs.handoff_id }}/${object}.json";
  const authorityDownload = applySteps.find((step) => step.name === "Download bound local authority");
  fail(
    authorityDownload?.run?.includes(stateBlob) &&
      authorityDownload.run.includes("for object in state provider") &&
      authorityDownload.run.includes("storage blob download"),
    "exact incoming state/provider downloads missing",
  );
  fail(apply.includes("state transfer-import") && apply.includes("provider transfer-import"), "apply imports missing");
  fail(
    apply.includes('cd "$APEX_RUNTIME_ROOT"\nnode "$cli" state transfer-import') &&
      apply.includes("$GITHUB_WORKSPACE/apex-live/incoming") &&
      !apply.includes("node packages/cli/dist/cli.js state transfer-import"),
    "apply must import state in the isolated runtime",
  );
  fail(
    apply.includes("$GITHUB_WORKSPACE/infra/terraform/vnext-qualification"),
    "Terraform source must bind to the exact checkout",
  );
  fail(
    index(apply, "state transfer-import") < index(apply, "provider transfer-import") &&
      index(apply, "provider transfer-import") < index(apply, "writer transfer-accept") &&
      index(apply, "writer transfer-accept") < index(apply, "approval show --json") &&
      index(apply, "approval show --json") < index(apply, "run?.ownerEpoch!==approval.writerEpoch+1") &&
      index(apply, "run?.ownerEpoch!==approval.writerEpoch+1") < index(apply, "storage blob delete"),
    "apply import, accept, approval, and deletion order invalid",
  );
  fail(
    apply.includes(".result.previewHash") &&
      apply.includes('= "$PREVIEW_HASH"') &&
      apply.includes(".result.provider") &&
      apply.includes('= "$TRACK"'),
    "imported provider binding validation missing",
  );
  fail(
    apply.includes("gate:4") &&
      apply.includes('decision:"approved"') &&
      apply.includes('mechanism:"tty"') &&
      apply.includes("previewHash:process.env.PREVIEW_HASH") &&
      apply.includes("recipientIdentity:process.env.APPLY_RECIPIENT") &&
      apply.includes("run?.ownerEpoch!==approval.writerEpoch+1"),
    "imported tty approval validation missing",
  );
  fail(apply.includes('deploy --preview "${{ inputs.preview_hash }}"'), "deploy must use exact dispatch preview hash");
  fail(
    apply.includes('denySettingsMode:"none"') && !apply.includes('denySettingsMode:"denyDelete"'),
    "qualification stack must not require deny-assignment permissions",
  );
  fail(
    apply.includes("terraform -chdir=infra/terraform/vnext-qualification init"),
    "fresh apply runner Terraform init missing",
  );
  fail(
    apply.includes(".apex/local/provider-runtime/bindings/${PREVIEW_HASH}.json") &&
      apply.includes(".attestation.lockfileHash") &&
      apply.includes('test "$lock_hash" = "$attested_lock_hash"') &&
      apply.includes('= "$attested_lock_hash"'),
    "apply must bind the current Terraform lock hash to imported attestation",
  );
  fail(
    applyJob.includes("local:${{ inputs.handoff_id }}") &&
      apply.match(/--file "\$GITHUB_WORKSPACE\/apex-live\/return-authority\.json"/g)?.length === 2,
    "return authority transfer missing",
  );
  fail(
    !uses(jobs.apply).some((action) => action.startsWith("actions/download-artifact@")),
    "artifact authority download forbidden",
  );
  const returnFallback = applySteps.find((step) => step.name === "Upload bound return fallback");
  fail(
    returnFallback?.uses === "actions/upload-artifact@v4" &&
      returnFallback.with?.path === "apex-live/return-authority.json" &&
      returnFallback.with?.["retention-days"] === 1 &&
      returnFallback.with?.["compression-level"] === 0 &&
      returnFallback.with?.["include-hidden-files"] === false &&
      returnFallback.with?.["if-no-files-found"] === "error",
    "encrypted return fallback artifact invalid",
  );
  const evidence = applySteps.find((step) => step.name === "Upload apply evidence");
  fail(
    evidence?.uses === "actions/upload-artifact@v4" &&
      evidence.with?.path === "apex-live/evidence/" &&
      evidence.with?.["retention-days"] === 1 &&
      evidence.with?.["compression-level"] === 0 &&
      evidence.with?.["include-hidden-files"] === false &&
      evidence.with?.["if-no-files-found"] === "error",
    "apply evidence artifact invalid",
  );
  fail(
    uses(jobs.apply).filter((action) => action === "actions/upload-artifact@v4").length >= 2,
    "apply artifacts invalid",
  );

  const combined = text;
  const forbidden = [
    /terraform\s+(?:-chdir=\S+\s+)?(?:apply|destroy)\b/,
    /az\s+stack\s+group\s+(?:create|delete)\b/,
    /az\s+deployment\s+(?:group|sub)\s+create\b/,
    /\bgate decide\b/,
    /\b(?:apex|cli\.js)\s+preview\b/,
    /github-environment/,
  ];
  for (const pattern of forbidden) fail(!pattern.test(combined), `forbidden direct mutation found: ${pattern}`);
  const artifactPaths = steps(jobs.apply)
    .filter((step) => step.uses === "actions/upload-artifact@v4")
    .map((step) => String(step.with?.path ?? ""))
    .join("\n");
  fail(
    !/(plan-transport\.key|\.tfplan|\.tfstate|\.apex\/|main\.parameters\.json)/.test(artifactPaths),
    "plaintext/key path in artifacts",
  );
  fail(!hasHiddenPathSegment(artifactPaths), "artifact upload path contains a hidden path segment");
  fail(
    Object.values(jobs).filter((job) => job.environment !== undefined).length === 1 &&
      jobs.apply?.environment === "vnext-qualification",
    "Environment must exist only on apply",
  );
  fail(
    !combined.includes("GITHUB_RUN_ATTEMPT -gt") && !combined.includes("GITHUB_RUN_ATTEMPT != 1"),
    "retry rollover allowed",
  );
  return errors;
}

export function validateWorkflowFile(file = WORKFLOW) {
  return validateWorkflowText(readFileSync(resolve(file), "utf8"));
}

function main() {
  const errors = validateWorkflowFile(process.argv[2] ?? WORKFLOW);
  if (errors.length === 0) {
    console.log("✅ vNext live workflow validation passed");
    return;
  }
  for (const error of errors) console.error(`❌ ${error}`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
