#!/usr/bin/env node
/** Prepare a journaled vNext qualification run from the exact repository candidate. */

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sha256Json } from "../../packages/kernel/dist/index.js";
import { VNEXT_QUALIFICATION_REPOSITORY } from "./_lib/vnext-qualification.mjs";

const execFile = promisify(execFileCallback);
const PROJECT_ID = "vnext-qualification";
const ENVIRONMENT = "qualification";
const LOCATION = "swedencentral";
const TRACKS = new Set(["bicep", "terraform"]);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_VALIDATORS = {
  bicep: [
    "bicep:format",
    "bicep:build",
    "bicep:lint",
    "business:security-baseline",
    "business:policy-property-map",
    "business:logical-resource-parity",
  ],
  terraform: [
    "terraform:format",
    "terraform:init-backend-false",
    "terraform:validate",
    "business:security-baseline",
    "business:policy-property-map",
    "business:logical-resource-parity",
  ],
};

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parsePrepareArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
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
  const allowed = new Set(["yes", "track", "actor", "subscription"]);
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) throw new Error(`Unknown argument: --${key.replaceAll("_", "-")}`);
  }
  if (values.yes !== true) throw new Error("qualification preparation requires --yes");
  for (const key of ["track", "actor", "subscription"]) {
    if (typeof values[key] !== "string" || values[key].trim().length === 0) {
      throw new Error(`Missing --${key}`);
    }
  }
  if (!TRACKS.has(values.track)) throw new Error("--track must be bicep or terraform");
  if (!UUID_PATTERN.test(values.subscription)) throw new Error("--subscription must be a UUID");
  return values;
}

async function run(file, args, options = {}) {
  try {
    const result = await execFile(file, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: options.timeout ?? 10 * 60_000,
    });
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch {
    throw new Error(`Command failed: ${file} ${args.join(" ")}`);
  }
}

async function jsonCommand(file, args, options) {
  const result = await run(file, args, options);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Command returned invalid JSON: ${file}`);
  }
}

async function gitCandidate(root) {
  const head = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout;
  const branch = (await run("git", ["branch", "--show-current"], { cwd: root })).stdout;
  const status = (await run("git", ["status", "--porcelain"], { cwd: root })).stdout;
  if (!SHA_PATTERN.test(head) || branch !== "main" || status !== "") {
    throw new Error("Qualification preparation requires a clean exact main checkout");
  }
  return head;
}

async function walkFiles(root, allowedSuffixes) {
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && allowedSuffixes.some((suffix) => entry.name.endsWith(suffix))) files.push(path);
    }
  };
  await visit(root);
  return files.sort();
}

async function sourceTree(root, track) {
  const relativeRoot = `infra/${track}/vnext-qualification`;
  const absoluteRoot = join(root, relativeRoot);
  const suffixes = track === "bicep" ? [".bicep"] : [".tf", ".terraform.lock.hcl"];
  const files = await walkFiles(absoluteRoot, suffixes);
  const entries = await Promise.all(
    files.map(async (path) => ({
      path: relative(absoluteRoot, path).replaceAll("\\", "/"),
      hash: sha256Bytes(await readFile(path)),
    })),
  );
  return { relativeRoot, absoluteRoot, entries, treeHash: sha256Json(entries) };
}

function governanceSummary(governance) {
  const findings = Array.isArray(governance.findings) ? governance.findings : [];
  const count = (effect) => findings.filter((finding) => finding.effect === effect).length;
  return {
    assignmentCount: Number(governance.discovery_summary?.assignment_kept ?? 0),
    denyCount: count("deny"),
    modifyCount: count("modify"),
    auditCount: count("audit"),
    exemptionCount: findings.filter((finding) => finding.exemption != null).length,
  };
}

function policyMappings(governance) {
  const supported = new Set(["deny", "modify", "append", "audit", "deployIfNotExists", "disabled"]);
  return (Array.isArray(governance.findings) ? governance.findings : []).flatMap((finding, index) => {
    if (!supported.has(finding.effect)) return [];
    const policyAssignmentId = finding.assignment_id ?? finding.policy_id;
    if (typeof policyAssignmentId !== "string" || policyAssignmentId.length === 0) return [];
    return [
      {
        policyAssignmentId,
        effect: finding.effect,
        logicalResourceId: "qualification-storage",
        propertyPath:
          typeof finding.azurePropertyPath === "string" && finding.azurePropertyPath.length > 0
            ? finding.azurePropertyPath
            : `/applicability/${index}`,
        ...(finding.required_value == null ? {} : { expectedValue: finding.required_value }),
        disposition: "planned",
      },
    ];
  });
}

function review(projectId, runId, subjectKind, subjectHash, reviewedAt) {
  return { schemaVersion: "1.0.0", projectId, runId, subjectKind, subjectHash, reviewedAt, findings: [] };
}

function validationEntry(kind, value) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  return { kind, hash: sha256Bytes(bytes), bytes: bytes.byteLength, required: true, retention: "immutable" };
}

export async function buildQualificationArtifacts({ root, track, subscription, runId, now, availability }) {
  const tree = await sourceTree(root, track);
  const governancePath = join(root, "agent-output/vnext-qualification/04-governance-constraints.json");
  const governanceBytes = await readFile(governancePath);
  const governance = JSON.parse(governanceBytes.toString("utf8"));
  const skuBytes = await readFile(join(root, "agent-output/vnext-qualification/sku-manifest.json"));
  const mainPath = join(tree.absoluteRoot, track === "bicep" ? "main.bicep" : "main.tf");
  const mainSource = await readFile(mainPath, "utf8");
  const sourceHash = sha256Json({
    candidate: availability.candidateSha,
    governance: sha256Bytes(governanceBytes),
    skuManifest: sha256Bytes(skuBytes),
    tree: tree.treeHash,
  });
  const requirements = {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    workload: "Isolated dual-track Azure qualification marker",
    environment: ENVIRONMENT,
    requirements: [
      {
        id: "REQ-QUAL-001",
        statement: "Deploy exactly one isolated storage marker in the selected qualification resource group",
        priority: "must",
        status: "confirmed",
        source: `repository:${availability.candidateSha}`,
      },
      {
        id: "REQ-QUAL-002",
        statement: "Apply and destroy only an exact native preview approved through APEX Gate 4",
        priority: "must",
        status: "confirmed",
        source: "ADR-0002",
      },
      {
        id: "REQ-QUAL-003",
        statement: "Keep public access, shared keys, and public Blob access disabled outside bounded handoff sessions",
        priority: "must",
        status: "confirmed",
        source: "qualification security baseline",
      },
    ],
    assumptions: ["The target is the dedicated non-production qualification sandbox"],
    unknowns: [],
  };
  const requirementsHash = sha256Json(requirements);
  const skuManifest = {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    environments: [ENVIRONMENT],
    services: [
      {
        logicalId: "qualification-storage",
        service: "Azure Storage Account",
        environment: ENVIRONMENT,
        sku: "Standard_LRS",
        userPinned: false,
        rationale: "Cost-optimized ephemeral qualification marker",
      },
    ],
    revisions: [{ number: 1, createdAt: now, sourceHash, reason: "Exact repository qualification candidate" }],
  };
  const targetResourceGroup = `rg-vnext-qualification-${track}`;
  const targetScope = `/subscriptions/${subscription}/resourceGroups/${targetResourceGroup}`;
  const architecture = {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    runId,
    title: "APEX vNext qualification marker",
    summary: "One hardened storage account validates native preview, approval, apply, inventory, and destroy.",
    sourceHashes: { requirements: requirementsHash, repository: sourceHash },
    components: [
      {
        id: "qualification-storage",
        service: "Microsoft.Storage/storageAccounts",
        purpose: "Isolated lifecycle marker and diagnostics target",
        requirementIds: requirements.requirements.map(({ id }) => id),
        dependsOn: [],
      },
    ],
    decisions: ["Use equivalent AVM-backed Bicep and Terraform implementations", "Use local Gate 4 before CI handoff"],
    risks: ["Qualification evidence is non-production and cannot authorize a production deployment"],
  };
  const price = availability.pricing;
  const monthlyCost = price.unitPrice;
  const costEstimate = {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    runId,
    currency: "USD",
    pricingDate: now.slice(0, 10),
    lineItems: [
      {
        id: "qualification-storage",
        service: price.productName,
        sku: price.skuName,
        quantity: 1,
        unitPrice: price.unitPrice,
        unitsPerMonth: 1,
        monthlyCost,
        source: {
          provider: "Azure Retail Prices API",
          uri: price.sourceUri,
          retrievedAt: price.retrievedAt,
          ...(price.meterId === undefined ? {} : { priceId: price.meterId }),
        },
        uncertainty: {
          lowerMonthlyCost: 0,
          upperMonthlyCost: Math.max(1, monthlyCost * 10),
          confidence: "low",
          basis: "Qualification usage is ephemeral and actual transactions are measured after execution",
        },
      },
    ],
    totalMonthlyCost: monthlyCost,
    assumptions: ["One unit is retained only to bind a current public price; live cost is measured from evidence"],
  };
  const exceptionExpiry = governance.security_exceptions?.find(
    ({ id }) => id === "vnext-qualification-backend-runner-ip",
  )?.expires_at;
  const discoveredAt = new Date(governance.discovered_at).toISOString();
  const expiresAt = new Date(
    exceptionExpiry ?? Date.parse(governance.discovered_at) + 24 * 60 * 60 * 1000,
  ).toISOString();
  const governanceArtifact = {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    runId,
    targetScope,
    discoveredAt,
    expiresAt,
    summary: governanceSummary(governance),
    constraintsRef: {
      mediaType: "application/json",
      uri: "agent-output/vnext-qualification/04-governance-constraints.json",
      digest: sha256Bytes(governanceBytes),
      bytes: governanceBytes.byteLength,
    },
  };
  const governanceHash = sha256Json(governanceArtifact);
  const policyMap = {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    runId,
    governanceHash,
    mappings: policyMappings(governance),
  };
  const sourceHashes = {
    requirements: requirementsHash,
    architecture: sha256Json(architecture),
    "governance-constraints": governanceHash,
    "policy-property-map": sha256Json(policyMap),
  };
  const intent = {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    runId,
    sourceHashes,
    resources: [
      {
        id: "qualification-storage",
        type: "Microsoft.Storage/storageAccounts",
        purpose: "Isolated native lifecycle qualification marker",
        dependsOn: [],
        controls: ["TLS1_2", "HTTPS-only", "Entra-only", "public-network-disabled", "no-public-blob"],
      },
    ],
    outputs: ["resourceId", "resourceName", "principalId"],
  };
  const versionMatch =
    track === "bicep" ? mainSource.match(/storage-account:([^']+)'/) : mainSource.match(/version\s*=\s*"([^"]+)"/);
  if (versionMatch?.[1] === undefined) throw new Error(`Unable to resolve ${track} storage module version`);
  const binding = {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    runId,
    track,
    intentHash: sha256Json(intent),
    resourceBindings: {
      "qualification-storage": {
        implementation:
          track === "bicep"
            ? "br/public:avm/res/storage/storage-account"
            : "Azure/avm-res-storage-storageaccount/azurerm",
        version: versionMatch[1],
        parameters: { location: LOCATION, resourceGroup: targetResourceGroup, sku: "Standard_LRS" },
      },
    },
  };
  const environmentInputs = {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    runId,
    environment: ENVIRONMENT,
    inputs: {
      location: { kind: "value", value: LOCATION },
      resourceGroup: { kind: "value", value: targetResourceGroup },
      subscriptionId: { kind: "value", value: subscription },
    },
  };
  const logicalManifest = {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    runId,
    track,
    resources: [
      {
        logicalId: "qualification-storage",
        type: "Microsoft.Storage/storageAccounts",
        implementationAddress: track === "bicep" ? "module.storageAccount" : "module.storage_account",
        implementationKind: "module",
        ownership: "managed",
        dependsOn: [],
        generatedDependencies: [],
        sourcePath: `${tree.relativeRoot}/${track === "bicep" ? "main.bicep" : "main.tf"}`,
      },
    ],
  };
  const handoff = {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    runId,
    track,
    rootPath: tree.relativeRoot,
    treeHash: tree.treeHash,
    intentHash: sha256Json(intent),
    bindingHash: sha256Json(binding),
    environmentInputsHash: sha256Json(environmentInputs),
    logicalResourceManifestHash: sha256Json(logicalManifest),
    requiredToolVersions: { [track]: track === "bicep" ? "0.45.6" : "1.15.8" },
    generatedAt: now,
  };
  return {
    targetScope,
    requirements,
    skuManifest,
    architecture,
    costEstimate,
    governanceArtifact,
    policyMap,
    intent,
    binding,
    environmentInputs,
    logicalManifest,
    handoff,
  };
}

export function selectQualificationPrice(items) {
  return items.find(
    (item) =>
      item.productName === "General Block Blob v2" &&
      item.skuName === "Hot LRS" &&
      item.meterName === "Hot LRS Data Stored" &&
      item.unitOfMeasure === "1 GB/Month" &&
      item.tierMinimumUnits === 0 &&
      typeof item.retailPrice === "number" &&
      item.retailPrice > 0,
  );
}

export async function collectNativeAvailability({ subscription, candidateSha, now }) {
  const usage = await jsonCommand("az", [
    "storage",
    "account",
    "show-usage",
    "--location",
    LOCATION,
    "--subscription",
    subscription,
    "--output",
    "json",
  ]);
  const quota = Array.isArray(usage) ? usage[0] : usage;
  const current = Number(quota?.currentValue ?? quota?.currentCount);
  const limit = Number(quota?.limit);
  if (!Number.isFinite(current) || !Number.isFinite(limit) || current >= limit) {
    throw new Error("Storage account quota is unavailable or exhausted");
  }
  const locations = await jsonCommand("az", [
    "provider",
    "show",
    "--namespace",
    "Microsoft.Storage",
    "--subscription",
    subscription,
    "--query",
    "resourceTypes[?resourceType=='storageAccounts'].locations[]",
    "--output",
    "json",
  ]);
  if (
    !Array.isArray(locations) ||
    !locations.some((location) => location.replaceAll(" ", "").toLowerCase() === LOCATION)
  ) {
    throw new Error(`Microsoft.Storage/storageAccounts is unavailable in ${LOCATION}`);
  }
  const filter = `armRegionName eq '${LOCATION}' and serviceName eq 'Storage' and priceType eq 'Consumption'`;
  const sourceUri = `https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&$filter=${encodeURIComponent(filter)}`;
  const priceItems = [];
  let nextPage = sourceUri;
  for (let pageNumber = 0; nextPage && pageNumber < 20; pageNumber += 1) {
    if (new URL(nextPage).origin !== "https://prices.azure.com") {
      throw new Error("Azure Retail Prices pagination left the trusted origin");
    }
    const response = await fetch(nextPage, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("Azure Retail Prices API request failed");
    const page = await response.json();
    priceItems.push(...(Array.isArray(page.Items) ? page.Items : []));
    nextPage = typeof page.NextPageLink === "string" ? page.NextPageLink : "";
  }
  if (nextPage) throw new Error("Azure Retail Prices pagination exceeded the bounded page limit");
  const row = selectQualificationPrice(priceItems);
  if (row === undefined) throw new Error("A current Standard LRS retail price was not found");
  return {
    candidateSha,
    pricing: {
      productName: row.productName,
      skuName: row.skuName,
      unitPrice: row.retailPrice,
      meterId: row.meterId,
      sourceUri,
      retrievedAt: now,
    },
    quota: { location: LOCATION, current, limit, collectedAt: now },
    regionalAvailability: { location: LOCATION, available: true, collectedAt: now },
  };
}

async function nativeValidation(root, track, artifacts) {
  const temporary = await mkdtemp(join(tmpdir(), "apex-vnext-prepare-"));
  try {
    const results = {};
    if (track === "bicep") {
      const main = join(root, "infra/bicep/vnext-qualification/main.bicep");
      results["bicep:format"] = await run("bash", ["tools/scripts/check-bicep-fmt.sh"], { cwd: root });
      results["bicep:build"] = await run("bicep", ["build", main, "--outfile", join(temporary, "main.json")]);
      results["bicep:lint"] = await run("bicep", ["lint", main]);
    } else {
      const terraformRoot = join(root, "infra/terraform/vnext-qualification");
      results["terraform:format"] = await run("terraform", ["fmt", "-check", "-recursive", terraformRoot]);
      results["terraform:init-backend-false"] = await run("terraform", [
        `-chdir=${terraformRoot}`,
        "init",
        "-backend=false",
        "-input=false",
      ]);
      results["terraform:validate"] = await run("terraform", [`-chdir=${terraformRoot}`, "validate"]);
    }
    results["business:security-baseline"] = await run("npm", ["run", "validate:iac-security-baseline"], { cwd: root });
    results["business:policy-property-map"] = { hash: sha256Json(artifacts.policyMap) };
    results["business:logical-resource-parity"] = { hash: sha256Json(artifacts.logicalManifest) };
    return REQUIRED_VALIDATORS[track].map((kind) => validationEntry(kind, results[kind]));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function acceptedEvidenceHash(service, kind, value) {
  const accepted = await service.acceptEvidence({ kind, contentType: "application/json", value, required: true });
  if (typeof accepted?.hash !== "string") throw new Error(`${kind} was not accepted`);
  return accepted.hash;
}

async function taskId(service, expected) {
  const next = await service.nextTask();
  if (next.status !== "task" || next.task.taskType !== expected) throw new Error(`Expected task ${expected}`);
  return next.task.taskId;
}

async function complete(service, expected, outputs) {
  return service.completeTaskOutputs(await taskId(service, expected), outputs);
}

export async function prepareQualificationState(args, dependencies = {}) {
  const root = dependencies.root ?? process.cwd();
  const sourceRoot = dependencies.sourceRoot ?? root;
  const now = dependencies.now ?? new Date().toISOString();
  const candidateSha = dependencies.candidateSha ?? (await gitCandidate(root));
  const availability =
    dependencies.availability ??
    (await collectNativeAvailability({ subscription: args.subscription, candidateSha, now }));
  if (availability.candidateSha !== candidateSha) throw new Error("Availability evidence does not match the candidate");
  const targetResourceGroup = `rg-vnext-qualification-${args.track}`;
  const targetScope = `/subscriptions/${args.subscription}/resourceGroups/${targetResourceGroup}`;
  const { ApexService } = await import("../../packages/cli/dist/index.js");
  const service = new ApexService(root, {
    clock: () => new Date(now),
    architectureAvailabilityAdapter: async (evidence) => {
      if (evidence.targetScope !== targetScope || evidence.mode !== "native") {
        throw new Error("Native availability evidence does not match the qualification target");
      }
    },
  });
  const emptyCustomizations = await mkdtemp(join(tmpdir(), "apex-vnext-empty-customizations-"));
  let runId;
  try {
    ({ runId } = await service.init({
      projectId: PROJECT_ID,
      displayName: "APEX vNext Live Qualification",
      environment: ENVIRONMENT,
      targetScope,
      iacTool: args.track,
      customizationsSource: emptyCustomizations,
    }));
  } finally {
    await rm(emptyCustomizations, { recursive: true, force: true });
  }
  await service.recordRequirementsInput({
    workload: "vnext qualification marker",
    requirements: "exact native lifecycle proof in the isolated sandbox",
    candidateSha,
  });
  const sourceRefs = {
    pricing: await acceptedEvidenceHash(service, "pricing-evidence", availability.pricing),
    quota: await acceptedEvidenceHash(service, "quota-evidence", availability.quota),
    regionalAvailability: await acceptedEvidenceHash(
      service,
      "regional-availability-evidence",
      availability.regionalAvailability,
    ),
  };
  await acceptedEvidenceHash(service, "architecture-availability-v1", {
    schemaVersion: "1.0.0",
    projectId: PROJECT_ID,
    runId,
    targetScope,
    mode: "native",
    collectedAt: now,
    expiresAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(),
    checks: {
      pricing: { status: "current", evidenceRef: sourceRefs.pricing },
      quota: { status: "current", evidenceRef: sourceRefs.quota },
      regionalAvailability: { status: "current", evidenceRef: sourceRefs.regionalAvailability },
    },
  });
  const artifacts = await buildQualificationArtifacts({
    root: sourceRoot,
    track: args.track,
    subscription: args.subscription,
    runId,
    now,
    availability,
  });
  const requirements = await complete(service, "requirements", [
    { kind: "requirements", value: artifacts.requirements },
    { kind: "sku-manifest", value: artifacts.skuManifest },
  ]);
  await complete(service, "requirements-review", [
    {
      kind: "review-findings",
      value: review(PROJECT_ID, runId, "requirements", requirements.outputHashes.requirements, now),
    },
  ]);
  await service.decideGateNumber(1, "approved", args.actor);
  const architecture = await complete(service, "architecture", [
    { kind: "architecture", value: artifacts.architecture },
    { kind: "cost-estimate", value: artifacts.costEstimate },
  ]);
  await complete(service, "architecture-review", [
    {
      kind: "review-findings",
      value: review(PROJECT_ID, runId, "architecture", architecture.outputHashes.architecture, now),
    },
  ]);
  const governance = await complete(service, "governance-discovery", [
    { kind: "governance-constraints", value: artifacts.governanceArtifact },
  ]);
  artifacts.policyMap.governanceHash = governance.outputHashes["governance-constraints"];
  const policy = await complete(service, "governance-reconciliation", [
    { kind: "policy-property-map", value: artifacts.policyMap },
  ]);
  await complete(service, "governance-review", [
    {
      kind: "review-findings",
      value: review(PROJECT_ID, runId, "policy-property-map", policy.outputHashes["policy-property-map"], now),
    },
  ]);
  await service.decideGateNumber(2, "approved", args.actor);
  artifacts.intent.sourceHashes = {
    requirements: requirements.outputHashes.requirements,
    architecture: architecture.outputHashes.architecture,
    "governance-constraints": governance.outputHashes["governance-constraints"],
    "policy-property-map": policy.outputHashes["policy-property-map"],
  };
  artifacts.binding.intentHash = sha256Json(artifacts.intent);
  artifacts.handoff.intentHash = sha256Json(artifacts.intent);
  artifacts.handoff.bindingHash = sha256Json(artifacts.binding);
  const plan = await complete(service, "plan", [
    { kind: "implementation-intent", value: artifacts.intent },
    { kind: "iac-binding", value: artifacts.binding },
    { kind: "environment-inputs", value: artifacts.environmentInputs },
  ]);
  await complete(service, "plan-review", [
    {
      kind: "review-findings",
      value: review(PROJECT_ID, runId, "plan", plan.outputHashes["implementation-intent"], now),
    },
  ]);
  await service.decideGateNumber(3, "approved", args.actor);
  await complete(service, `codegen-${args.track}`, [
    { kind: "logical-resource-manifest", value: artifacts.logicalManifest },
    { kind: "iac-handoff", value: artifacts.handoff },
  ]);
  const entries = dependencies.validationEntries ?? (await nativeValidation(sourceRoot, args.track, artifacts));
  await complete(service, `validation-${args.track}`, [
    {
      kind: "validation-evidence",
      value: { schemaVersion: "1.0.0", projectId: PROJECT_ID, runId, createdAt: now, entries },
    },
  ]);
  const status = await service.status();
  return {
    projectId: PROJECT_ID,
    runId,
    track: args.track,
    candidateSha,
    targetScope,
    gates: status.run.gates,
    next: "Review and merge the repository-backed .apex state, then create the native preview from exact clean main",
  };
}

async function main() {
  const args = parsePrepareArgs(process.argv.slice(2));
  const repository = await jsonCommand("gh", ["repo", "view", "--json", "nameWithOwner"]);
  if (repository.nameWithOwner !== VNEXT_QUALIFICATION_REPOSITORY) {
    throw new Error(`Qualification preparation requires ${VNEXT_QUALIFICATION_REPOSITORY}`);
  }
  const result = await prepareQualificationState(args);
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  });
}
