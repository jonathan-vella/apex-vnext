import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  buildQualificationArtifacts,
  parsePrepareArgs,
  prepareQualificationState,
  selectQualificationPrice,
} from "../scripts/vnext-live-prepare.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const CANDIDATE_SHA = "a".repeat(40);
const SUBSCRIPTION = "b47d2942-f5ad-4d3c-b28e-c23e4f83d97e";
const TOOL_PINS = JSON.parse(readFileSync(join(ROOT, "tools/registry/tool-version-pins.json"), "utf8")).pins;
const GOVERNANCE_DISCOVERED_AT = JSON.parse(
  readFileSync(join(ROOT, "agent-output/vnext-qualification/04-governance-constraints.json"), "utf8"),
).discovered_at;

function minutesAfterGovernance(minutes) {
  return new Date(Date.parse(GOVERNANCE_DISCOVERED_AT) + minutes * 60 * 1000).toISOString();
}

const NOW = minutesAfterGovernance(10);
const BASELINE = join(mkdtempSyncCompat(), "governance-policy-baseline.json");

function mkdtempSyncCompat() {
  const directory = join(tmpdir(), `apex-live-prepare-baseline-${process.pid}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

writeFileSync(
  BASELINE,
  JSON.stringify({
    schema_version: "governance-baseline-v1",
    subscription_id: SUBSCRIPTION,
    coverage_status: "COMPLETE",
    subscriptions_discovered: 1,
    subscriptions_processed: 1,
    subscriptions_skipped: [],
    subscriptions_excluded: [],
    summary: { total_findings: 0, total_blockers: 0, total_auto_remediate: 0, subscriptions_complete: 1 },
    subscriptions: {
      [SUBSCRIPTION]: {
        schema_version: "governance-constraints-v1",
        subscription_id: SUBSCRIPTION,
        discovered_at: GOVERNANCE_DISCOVERED_AT,
        source: "github-actions-baseline",
        discovery_status: "COMPLETE",
        discovery_metadata: {
          discovery_status: "COMPLETE",
          discovered_at: GOVERNANCE_DISCOVERED_AT,
          scope: { subscription_id: SUBSCRIPTION, management_groups: [], coverage: "subscription-and-descendants-v1" },
          api_versions: {
            policyAssignments: "2022-06-01",
            policyDefinitions: "2021-06-01",
            policyExemptions: "2022-07-01-preview",
          },
          page_counts: { policyAssignments: 0, policyDefinitions: 0, policyExemptions: 0 },
          completeness_signature: "",
          ttl_days: 7,
        },
        discovery_summary: {
          assignment_total: 0,
          assignment_kept: 0,
          defender_auto_filtered: 0,
          subscription_scope_count: 0,
          management_group_inherited_count: 0,
          blocker_count: 0,
          auto_remediate_count: 0,
          informational_count: 0,
          audit_count: 0,
          disabled_count: 0,
          exempted_count: 0,
          classified_policy_count: 0,
          other_effect_count: 0,
        },
        assignment_inventory: [],
        findings: [],
        policies: [],
        tags_required: [],
        allowed_locations: [],
      },
    },
  }),
);

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function availability() {
  return {
    candidateSha: CANDIDATE_SHA,
    pricing: {
      productName: "Storage",
      skuName: "Standard LRS",
      unitPrice: 0.01,
      meterId: "qualification-meter",
      sourceUri: "https://prices.azure.com/api/retail/prices",
      retrievedAt: NOW,
    },
    quota: { location: "swedencentral", current: 6, limit: 250, collectedAt: NOW },
    regionalAvailability: { location: "swedencentral", available: true, collectedAt: NOW },
  };
}

function validationEntries(track) {
  const kinds =
    track === "bicep"
      ? ["bicep:format", "bicep:build", "bicep:lint"]
      : ["terraform:format", "terraform:init-backend-false", "terraform:validate"];
  kinds.push("business:security-baseline", "business:policy-property-map", "business:logical-resource-parity");
  return kinds.map((kind) => ({
    kind,
    hash: digest({ kind }),
    bytes: kind.length,
    required: true,
    retention: "immutable",
  }));
}

test("prepare arguments require explicit actor, track, subscription, baseline, and confirmation", () => {
  const base = ["--yes", "--actor", "maintainer", "--subscription", SUBSCRIPTION, "--baseline", "baseline.json"];
  assert.deepEqual(parsePrepareArgs([...base, "--track", "bicep"]), {
    yes: true,
    track: "bicep",
    actor: "maintainer",
    subscription: SUBSCRIPTION,
    baseline: "baseline.json",
  });
  assert.throws(() => parsePrepareArgs(["--track", "bicep"]), /requires --yes/);
  assert.throws(() => parsePrepareArgs(base.slice(0, -2).concat("--track", "bicep")), /Missing --baseline/);
  assert.throws(() => parsePrepareArgs([...base, "--track", "fake"]), /bicep or terraform/);
  assert.equal(
    parsePrepareArgs([
      "--yes",
      "--replace-existing",
      "--track",
      "bicep",
      "--actor",
      "maintainer",
      "--subscription",
      SUBSCRIPTION,
      "--baseline",
      "baseline.json",
    ]).replace_existing,
    true,
  );
});

test("package command stages bundled runtime assets before live preparation", async () => {
  const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["prepare:vnext-live"],
    "npm run prepare:vnext-assets && npm run build:vnext && node tools/scripts/vnext-live-prepare.mjs",
  );
});

test("qualification pricing rejects unrelated LRS products and selects the base Hot LRS capacity tier", () => {
  const expected = {
    productName: "General Block Blob v2",
    skuName: "Hot LRS",
    meterName: "Hot LRS Data Stored",
    unitOfMeasure: "1 GB/Month",
    tierMinimumUnits: 0,
    retailPrice: 0.0184,
  };
  assert.equal(
    selectQualificationPrice([
      {
        productName: "Ultra Disks",
        skuName: "Ultra LRS",
        meterName: "LRS Provisioned Capacity",
        unitOfMeasure: "1 GiB/Hour",
        tierMinimumUnits: 0,
        retailPrice: 0.000172,
      },
      { ...expected, tierMinimumUnits: 51200, retailPrice: 0.017664 },
      expected,
    ]),
    expected,
  );
});

for (const track of ["bicep", "terraform"]) {
  test(`${track} qualification artifacts bind the exact repository tree`, async () => {
    const artifacts = await buildQualificationArtifacts({
      root: ROOT,
      track,
      subscription: SUBSCRIPTION,
      runId: "run-qualification",
      now: NOW,
      availability: availability(),
    });

    assert.equal(artifacts.intent.resources.length, 1);
    assert.equal(artifacts.intent.resources[0].id, "qualification-storage");
    assert.equal(artifacts.binding.track, track);
    assert.equal(
      artifacts.logicalManifest.resources[0].implementationAddress,
      artifacts.binding.resourceBindings["qualification-storage"].implementation,
    );
    assert.match(artifacts.handoff.treeHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(artifacts.handoff.requiredToolVersions, { [track]: TOOL_PINS[track].min });
    assert.deepEqual(artifacts.architecture.components[0].resourceTypes, ["Microsoft.Storage/storageAccounts"]);
  });
}

test("preparation creates a validated run with Gates 1-3 approved and Gate 4 closed", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "apex-vnext-live-prepare-"));
  try {
    await mkdir(join(stateRoot, ".github"), { recursive: true });
    await writeFile(join(stateRoot, ".github/copilot-instructions.md"), "source-owned\n", "utf8");
    const result = await prepareQualificationState(
      { yes: true, track: "bicep", actor: "maintainer", subscription: SUBSCRIPTION, baseline: BASELINE },
      {
        root: stateRoot,
        sourceRoot: ROOT,
        candidateSha: CANDIDATE_SHA,
        now: NOW,
        availability: availability(),
        validationEntries: validationEntries("bicep"),
      },
    );

    assert.equal(result.projectId, "vnext-qualification");
    assert.deepEqual(
      result.gates.map(({ gate, state }) => [gate, state]),
      [
        [1, "approved"],
        [2, "approved"],
        [3, "approved"],
        [4, "closed"],
      ],
    );
    const selection = JSON.parse(await readFile(join(stateRoot, ".apex/config.json"), "utf8"));
    assert.equal(selection.projectId, "vnext-qualification");
    assert.equal(selection.runId, result.runId);
    assert.equal(await readFile(join(stateRoot, ".github/copilot-instructions.md"), "utf8"), "source-owned\n");
    const customizationLock = JSON.parse(await readFile(join(stateRoot, ".apex/customizations.lock.json"), "utf8"));
    assert.deepEqual(customizationLock.files, []);
    assert.ok(customizationLock.runtime.length > 0);

    const runDirectory = join(stateRoot, ".apex/projects/vnext-qualification/runs", result.runId);
    const run = JSON.parse(await readFile(join(runDirectory, "run.json"), "utf8"));
    const lockPath = join(stateRoot, ".apex/runtime-generations", run.runtimeLockHash, "apex.lock.json");
    const originalLock = await readFile(lockPath, "utf8");
    const originalSelection = await readFile(join(stateRoot, ".apex/config.json"), "utf8");
    const legacyLock = JSON.parse(originalLock);
    delete legacyLock.improvementPolicyHash;
    const invalidLock = `${JSON.stringify(legacyLock, null, 2)}\n`;
    await writeFile(lockPath, invalidLock, "utf8");
    await assert.rejects(
      prepareQualificationState(
        {
          yes: true,
          replace_existing: true,
          track: "bicep",
          actor: "maintainer",
          subscription: SUBSCRIPTION,
          baseline: BASELINE,
        },
        {
          root: stateRoot,
          sourceRoot: ROOT,
          candidateSha: CANDIDATE_SHA,
          now: minutesAfterGovernance(20),
          availability: availability(),
          validationEntries: validationEntries("bicep"),
        },
      ),
      /runtime-lock validation failed/,
    );
    assert.equal(await readFile(lockPath, "utf8"), invalidLock);
    assert.equal(await readFile(join(stateRoot, ".apex/config.json"), "utf8"), originalSelection);
    assert.deepEqual(
      (await readdir(stateRoot)).filter((entry) => entry.startsWith(".apex-state-backup-")),
      [],
    );
    await writeFile(lockPath, originalLock, "utf8");

    const ownershipPath = join(runDirectory, "ownership.json");
    await writeFile(ownershipPath, "{}\n", "utf8");
    await assert.rejects(
      prepareQualificationState(
        {
          yes: true,
          replace_existing: true,
          track: "bicep",
          actor: "maintainer",
          subscription: SUBSCRIPTION,
          baseline: BASELINE,
        },
        {
          root: stateRoot,
          sourceRoot: ROOT,
          candidateSha: CANDIDATE_SHA,
          now: minutesAfterGovernance(20),
          availability: availability(),
          validationEntries: validationEntries("bicep"),
        },
      ),
      /writer ownership/,
    );
    assert.equal(await readFile(ownershipPath, "utf8"), "{}\n");
    assert.equal(await readFile(join(stateRoot, ".apex/config.json"), "utf8"), originalSelection);
    assert.deepEqual(
      (await readdir(stateRoot)).filter((entry) => entry.startsWith(".apex-state-backup-")),
      [],
    );
    await rm(ownershipPath);

    const replacement = await prepareQualificationState(
      {
        yes: true,
        replace_existing: true,
        track: "bicep",
        actor: "maintainer",
        subscription: SUBSCRIPTION,
        baseline: BASELINE,
      },
      {
        root: stateRoot,
        sourceRoot: ROOT,
        candidateSha: CANDIDATE_SHA,
        now: minutesAfterGovernance(20),
        availability: availability(),
        validationEntries: validationEntries("bicep"),
      },
    );
    assert.notEqual(replacement.runId, result.runId);
    const replacementSelection = JSON.parse(await readFile(join(stateRoot, ".apex/config.json"), "utf8"));
    assert.equal(replacementSelection.runId, replacement.runId);
    assert.deepEqual(
      (await readdir(stateRoot)).filter((entry) => entry.startsWith(".apex-state-backup-")),
      [],
    );

    const beforeFailedReplacement = await readFile(join(stateRoot, ".apex/config.json"), "utf8");
    await assert.rejects(
      prepareQualificationState(
        {
          yes: true,
          replace_existing: true,
          track: "bicep",
          actor: "maintainer",
          subscription: SUBSCRIPTION,
          baseline: BASELINE,
        },
        {
          root: stateRoot,
          sourceRoot: ROOT,
          candidateSha: CANDIDATE_SHA,
          now: minutesAfterGovernance(30),
          availability: availability(),
          validationEntries: validationEntries("bicep").slice(0, -1),
        },
      ),
      /business:logical-resource-parity/,
    );
    assert.equal(await readFile(join(stateRoot, ".apex/config.json"), "utf8"), beforeFailedReplacement);
    assert.deepEqual(
      (await readdir(stateRoot)).filter((entry) => entry.startsWith(".apex-state-backup-")),
      [],
    );
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
