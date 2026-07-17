import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const NOW = "2026-07-17T07:10:00.000Z";
const SUBSCRIPTION = "00858ffc-dded-4f0f-8bbf-e17fff0d47d9";

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

test("prepare arguments require explicit actor, track, subscription, and confirmation", () => {
  assert.deepEqual(
    parsePrepareArgs(["--yes", "--track", "bicep", "--actor", "maintainer", "--subscription", SUBSCRIPTION]),
    { yes: true, track: "bicep", actor: "maintainer", subscription: SUBSCRIPTION },
  );
  assert.throws(() => parsePrepareArgs(["--track", "bicep"]), /requires --yes/);
  assert.throws(
    () => parsePrepareArgs(["--yes", "--track", "fake", "--actor", "maintainer", "--subscription", SUBSCRIPTION]),
    /bicep or terraform/,
  );
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
  test(`${track} qualification artifacts bind the exact repository tree and governance snapshot`, async () => {
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
    assert.match(artifacts.handoff.treeHash, /^[0-9a-f]{64}$/);
    assert.match(artifacts.governanceArtifact.constraintsRef.digest, /^[0-9a-f]{64}$/);
    assert.equal(artifacts.governanceArtifact.targetScope, `${artifacts.targetScope}`);
  });
}

test("preparation creates a validated run with Gates 1-3 approved and Gate 4 closed", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "apex-vnext-live-prepare-"));
  try {
    await mkdir(join(stateRoot, ".github"), { recursive: true });
    await writeFile(join(stateRoot, ".github/copilot-instructions.md"), "source-owned\n", "utf8");
    const result = await prepareQualificationState(
      { yes: true, track: "bicep", actor: "maintainer", subscription: SUBSCRIPTION },
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

    const replacement = await prepareQualificationState(
      {
        yes: true,
        replace_existing: true,
        track: "bicep",
        actor: "maintainer",
        subscription: SUBSCRIPTION,
      },
      {
        root: stateRoot,
        sourceRoot: ROOT,
        candidateSha: CANDIDATE_SHA,
        now: "2026-07-17T07:20:00.000Z",
        availability: availability(),
        validationEntries: validationEntries("bicep"),
      },
    );
    assert.notEqual(replacement.runId, result.runId);
    const replacementSelection = JSON.parse(await readFile(join(stateRoot, ".apex/config.json"), "utf8"));
    assert.equal(replacementSelection.runId, replacement.runId);

    const beforeFailedReplacement = await readFile(join(stateRoot, ".apex/config.json"), "utf8");
    await assert.rejects(
      prepareQualificationState(
        {
          yes: true,
          replace_existing: true,
          track: "bicep",
          actor: "maintainer",
          subscription: SUBSCRIPTION,
        },
        {
          root: stateRoot,
          sourceRoot: ROOT,
          candidateSha: CANDIDATE_SHA,
          now: "2026-07-17T07:30:00.000Z",
          availability: availability(),
          validationEntries: validationEntries("bicep").slice(0, -1),
        },
      ),
      /business:logical-resource-parity/,
    );
    assert.equal(await readFile(join(stateRoot, ".apex/config.json"), "utf8"), beforeFailedReplacement);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
