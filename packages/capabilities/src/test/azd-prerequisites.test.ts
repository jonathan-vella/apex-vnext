import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAzdPrerequisite, satisfiesAzdVersionConstraint } from "../azd-prerequisites.js";

test("the azd prerequisite accepts only the exact pinned release and names a remedy otherwise", () => {
  assert.deepEqual(evaluateAzdPrerequisite({ pinnedVersion: "1.35.1", found: true, installedVersion: "1.35.1" }), {
    ok: true,
    value: "1.35.1",
  });
  const cases: Array<[Parameters<typeof evaluateAzdPrerequisite>[0], string, RegExp]> = [
    [{ pinnedVersion: undefined, found: true, installedVersion: "1.35.1" }, "AZD_PIN_UNAVAILABLE", /Reinstall/u],
    [{ pinnedVersion: "1.35.1", found: false, installedVersion: undefined }, "AZD_NOT_FOUND", /Install azd 1\.35\.1/u],
    [{ pinnedVersion: "1.35.1", found: true, installedVersion: undefined }, "AZD_VERSION_UNAVAILABLE", /azd version/u],
    [
      { pinnedVersion: "1.35.1", found: true, installedVersion: "1.35.0" },
      "AZD_VERSION_MISMATCH",
      /exact azd version/u,
    ],
    [
      { pinnedVersion: "1.35.1", found: true, installedVersion: "1.35.2" },
      "AZD_VERSION_MISMATCH",
      /exact azd version/u,
    ],
    [
      { pinnedVersion: "1.35.1", found: true, installedVersion: "1.100.0" },
      "AZD_VERSION_MISMATCH",
      /exact azd version/u,
    ],
    [
      { pinnedVersion: "1.35.1", found: true, installedVersion: "0.99.99" },
      "AZD_VERSION_MISMATCH",
      /exact azd version/u,
    ],
  ];
  for (const [input, code, remedy] of cases) {
    const result = evaluateAzdPrerequisite(input);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.match(result.remedy ?? "", remedy);
  }
  assert.match(
    evaluateAzdPrerequisite({ pinnedVersion: "1.35.1", found: true, installedVersion: "1.36.0" }).value,
    /newer than the pinned/u,
  );
  assert.match(
    evaluateAzdPrerequisite({ pinnedVersion: "1.35.1", found: true, installedVersion: "1.2.9" }).value,
    /older than the pinned/u,
  );
});

test("azure.yaml azd version constraints evaluate comparators and reject other syntax", () => {
  const table: Array<[string, boolean | undefined]> = [
    ["1.35.1", true],
    ["=1.35.1", true],
    ["v1.35.1", true],
    [">=1.35.1", true],
    [">= 1.35.1", true],
    [">1.35.1", false],
    ["<=1.35.1", true],
    ["<1.35.1", false],
    ["!=1.35.1", false],
    ["!=1.35.0", true],
    [">=1.0.0 <2.0.0", true],
    [">=1.0.0, <1.35.1", false],
    ["<1.0.0 || >=1.35.0", true],
    ["<1.0.0 || >=2.0.0", false],
    [">= 0.6.0-beta.3", true],
    ["1.35.1-beta.1", false],
    [">1.35.1-beta.1", true],
    ["~1.35", undefined],
    ["^1.0.0", undefined],
    ["1.x", undefined],
    [">=1.35", undefined],
    ["latest", undefined],
    ["", undefined],
    ["||", undefined],
    [">=1.0.0 junk", undefined],
  ];
  for (const [constraint, expected] of table)
    assert.equal(satisfiesAzdVersionConstraint("1.35.1", constraint), expected, constraint);
  assert.equal(satisfiesAzdVersionConstraint("1.35.1-beta.1", ">=1.0.0"), undefined);
});
