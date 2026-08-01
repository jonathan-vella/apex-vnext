import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateScenario,
  median,
  parseArgs,
  parseSelectedHooks,
  PRECOMMIT_SCENARIOS,
} from "../scripts/measure-precommit-baseline.mjs";

test("calculates the median without mutating samples", () => {
  const samples = [900, 300, 600];
  assert.equal(median(samples), 600);
  assert.deepEqual(samples, [900, 300, 600]);
});

test("extracts sorted executed hooks from non-interactive Lefthook output", () => {
  const output = [
    "summary: (done in 1.00 seconds)",
    "✓ secrets-baseline (0.20 seconds)",
    "✓ js-lint (0.80 seconds)",
  ].join("\n");
  assert.deepEqual(parseSelectedHooks(output), ["js-lint", "secrets-baseline"]);
});

test("accepts matching successful hooks within material timing tolerance", () => {
  const base = { medianMs: 1000, exitStatuses: [0, 0, 0], selectedHooks: ["secrets", "lint"] };
  const candidate = { medianMs: 1250, exitStatuses: [0, 0, 0], selectedHooks: ["lint", "secrets"] };
  assert.deepEqual(evaluateScenario(base, candidate, ["lint", "secrets"]), {
    hooksMatch: true,
    exitsPass: true,
    timingPass: true,
    toleranceMs: 250,
    timingLimitMs: 1250,
    pass: true,
  });
});

test("parses benchmark refs and rejects missing option values", () => {
  assert.deepEqual(parseArgs(["--base", "base-ref", "--candidate", "candidate-ref", "--output", "report.json"]), {
    base: "base-ref",
    candidate: "candidate-ref",
    output: "report.json",
  });
  assert.throws(() => parseArgs(["--base"]), /--base requires a value/u);
  assert.throws(() => parseArgs(["--candidate", "--output", "report.json"]), /--candidate requires a value/u);
});

test("rejects selection, exit, and material timing regressions", () => {
  const base = { medianMs: 400, exitStatuses: [0, 0, 0], selectedHooks: ["lint"] };
  const candidate = { medianMs: 651, exitStatuses: [0, 1, 0], selectedHooks: ["other"] };
  assert.deepEqual(evaluateScenario(base, candidate, ["lint"]), {
    hooksMatch: false,
    exitsPass: false,
    timingPass: false,
    toleranceMs: 250,
    timingLimitMs: 650,
    pass: false,
  });
});

test("tracked baseline evidence reproduces every passing verdict", () => {
  const evidence = JSON.parse(readFileSync(new URL("../registry/precommit-baseline.json", import.meta.url), "utf8"));
  assert.equal(evidence.status, "pass");
  assert.equal(evidence.sampleCount, 3);

  for (const scenario of PRECOMMIT_SCENARIOS) {
    const tracked = evidence.scenarios.find(({ id }) => id === scenario.id);
    assert.ok(tracked, `missing tracked scenario ${scenario.id}`);
    assert.equal(tracked.baseMedianMilliseconds, median(tracked.baseSamplesMilliseconds));
    assert.equal(tracked.candidateMedianMilliseconds, median(tracked.candidateSamplesMilliseconds));
    const evaluation = evaluateScenario(
      {
        medianMs: tracked.baseMedianMilliseconds,
        exitStatuses: tracked.baseExitStatuses,
        selectedHooks: tracked.selectedHooks,
      },
      {
        medianMs: tracked.candidateMedianMilliseconds,
        exitStatuses: tracked.candidateExitStatuses,
        selectedHooks: tracked.selectedHooks,
      },
      scenario.expectedHooks,
    );
    assert.equal(evaluation.pass, true, `${scenario.id} evidence does not pass`);
    assert.equal(tracked.status, "pass");
  }
});
