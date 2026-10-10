import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { collectGuidanceDeliveryInputs, validateGuidanceDelivery } from "../scripts/validate-guidance-delivery.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const current = () => structuredClone(collectGuidanceDeliveryInputs(root));

test("current source delivery preserves complete deferred obligations without mutation", () => {
  const inputs = current();
  const before = structuredClone(inputs);
  assert.deepEqual(validateGuidanceDelivery(inputs), []);
  assert.deepEqual(inputs, before);
  assert.equal(inputs.registry.skills.length, 32);
  assert.equal(inputs.registry.instructions.length, 21);
  assert.equal(inputs.registry.maintainerSkills.length, 8);
  assert.equal(inputs.registry.deferredCapabilities.length, 206);
});

for (const [name, mutate] of [
  [
    "missing source file",
    (x) => {
      x.sourceSkills.pop();
    },
  ],
  [
    "unexpected source skill",
    (x) => {
      x.sourceSkills.push(".github/skills/apex-extra/SKILL.md");
    },
  ],
  [
    "missing managed file",
    (x) => {
      x.manifest.plugin.files = x.manifest.plugin.files.filter((name) => name !== x.registry.skills[0].entrypoint);
    },
  ],
  [
    "unmanaged declared file",
    (x) => {
      x.registry.skills[0].files.push(".github/skills/apex-architecture/unowned.md");
    },
  ],
  [
    "wrong skill owner",
    (x) => {
      x.registry.skills[0].owner = "";
    },
  ],
  [
    "missing skill entrypoint",
    (x) => {
      x.registry.skills[0].files.shift();
    },
  ],
  [
    "duplicate skill ID",
    (x) => {
      x.registry.skills[1].id = x.registry.skills[0].id;
    },
  ],
  [
    "unsorted skill IDs",
    (x) => {
      x.registry.skills.reverse();
    },
  ],
  [
    "duplicate skill path",
    (x) => {
      x.registry.skills[0].files.push(x.registry.skills[0].entrypoint);
    },
  ],
  [
    "path traversal",
    (x) => {
      x.registry.skills[0].files.push(".github/skills/apex-architecture/../escape.md");
    },
  ],
  [
    "wrong instruction mapping",
    (x) => {
      x.manifest.managedFiles = x.manifest.managedFiles.filter((name) => name !== x.registry.instructions[0].path);
    },
  ],
  [
    "missing instruction",
    (x) => {
      x.sourceInstructions.pop();
    },
  ],
  [
    "unexpected instruction",
    (x) => {
      x.sourceInstructions.push(".github/instructions/apex-extra.instructions.md");
    },
  ],
  [
    "missing maintainer",
    (x) => {
      x.maintainerEntrypoints.pop();
    },
  ],
  [
    "wrong maintainer entrypoint",
    (x) => {
      x.registry.maintainerSkills[0].entrypoint = ".github/skills/extra/SKILL.md";
    },
  ],
  [
    "unsupported schema version",
    (x) => {
      x.registry.schemaVersion = "0.9.0";
    },
  ],
  [
    "unknown property",
    (x) => {
      x.registry.untrusted = true;
    },
  ],
  [
    "old migration format",
    (x) => {
      x.registry = { schemaVersion: "1.0.0", skillDispositions: [] };
    },
  ],
  [
    "missing deferred owner",
    (x) => {
      delete x.registry.deferredCapabilities[0].ownerPackage;
    },
  ],
  [
    "missing deferred hash",
    (x) => {
      delete x.registry.deferredCapabilities[0].sourceSha256;
    },
  ],
  [
    "changed deferred hash",
    (x) => {
      x.registry.deferredCapabilities[0].sourceSha256 = "a".repeat(64);
    },
  ],
  [
    "changed deferred reason",
    (x) => {
      x.registry.deferredCapabilities[0].reason = "Reclassified";
    },
  ],
  [
    "removed deferred obligation",
    (x) => {
      x.registry.deferredCapabilities.pop();
    },
  ],
  [
    "implemented deferred obligation",
    (x) => {
      x.registry.deferredCapabilities[0].status = "implemented";
    },
  ],
  [
    "missing deferred managed skill",
    (x) => {
      x.registry.deferredCapabilities[0].managedSkill = "apex-missing";
    },
  ],
  [
    "claimed live qualification",
    (x) => {
      x.registry.qualification.live = "qualified";
    },
  ],
  [
    "claimed client qualification",
    (x) => {
      x.registry.qualification.clients = "qualified";
    },
  ],
]) {
  test(`rejects ${name} without modifying inputs`, () => {
    const inputs = current();
    mutate(inputs);
    const before = structuredClone(inputs);
    assert.ok(validateGuidanceDelivery(inputs).length > 0);
    assert.deepEqual(inputs, before);
  });
}

function fixture(context) {
  const directory = mkdtempSync(path.join(tmpdir(), "apex-current-delivery-"));
  context.after(() => rmSync(directory, { recursive: true }));
  for (const name of [
    "customizations/manifest.json",
    "customizations/.github/skills",
    "customizations/.github/instructions",
    "tools/registry/guidance-delivery.v1.json",
    "tools/registry/schemas/guidance-delivery.schema.json",
    ...current().maintainerEntrypoints,
  ]) {
    mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    cpSync(path.join(root, name), path.join(directory, name), { recursive: true });
  }
  return directory;
}

test("collector passes with no historical product skills, installed state or archive", (context) => {
  const directory = fixture(context);
  assert.deepEqual(validateGuidanceDelivery(collectGuidanceDeliveryInputs(directory)), []);
});

test("collector fails on missing registered entrypoint", (context) => {
  const directory = fixture(context);
  rmSync(path.join(directory, "customizations/.github/skills/apex-architecture/SKILL.md"));
  assert.ok(validateGuidanceDelivery(collectGuidanceDeliveryInputs(directory)).length > 0);
});

test("unexpected managed source fails instead of falling back to a catalog declaration", (context) => {
  const directory = fixture(context);
  writeFileSync(path.join(directory, "customizations/.github/skills/apex-architecture/unmapped.md"), "unmapped");
  assert.ok(validateGuidanceDelivery(collectGuidanceDeliveryInputs(directory)).length > 0);
});

test("collector rejects current-source symlink traversal", (context) => {
  const directory = fixture(context);
  const skill = path.join(directory, "customizations/.github/skills/apex-architecture");
  symlinkSync(skill, path.join(skill, "loop"), "dir");
  assert.throws(() => collectGuidanceDeliveryInputs(directory), /symlink/u);
});

test("collector rejects unreadable current-source roots without silent defaults", (context) => {
  const directory = fixture(context);
  rmSync(path.join(directory, "customizations/.github/instructions"), { recursive: true });
  assert.throws(() => collectGuidanceDeliveryInputs(directory), /ENOENT/u);
});
