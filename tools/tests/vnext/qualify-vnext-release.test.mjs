import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseReleaseQualificationArguments, runReleaseQualification } from "../../scripts/qualify-vnext-release.mjs";

const candidate = "a".repeat(40);

async function writePassingScorecard(scorecard) {
  await mkdir(join(scorecard, "workspace"), { recursive: true });
  await writeFile(join(scorecard, "workspace", "large.tmp"), "discard");
  await writeFile(join(scorecard, "qualification.json"), '{"reports":[]}\n');
  await writeFile(join(scorecard, "measurements.json"), '{"measurements":[]}\n');
  await writeFile(
    join(scorecard, "evaluation.json"),
    '{"status":"pass","evaluations":[{"metric":"example","decision":"pass"}]}\n',
  );
  await writeFile(join(scorecard, "evaluation.md"), "## Evaluation\n");
}

test("release qualification requires a fixed collection time", () => {
  assert.throws(() => parseReleaseQualificationArguments([]), /collected-at/);
  assert.throws(() => parseReleaseQualificationArguments(["--collected-at", "invalid"]), /ISO/);
  assert.equal(
    parseReleaseQualificationArguments(["--collected-at", "2026-07-21T06:50:00.000Z"]).collectedAt,
    "2026-07-21T06:50:00.000Z",
  );
});

test("release qualification runs in order, compacts evidence, and denies promotion authority", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-release-runner-"));
  const output = join(root, "evidence");
  const commands = [];
  const run = async (command, args, { log }) => {
    commands.push([command, ...args]);
    await mkdir(join(log, ".."), { recursive: true });
    await writeFile(log, `${command} ${args.join(" ")}\n`);
    if (args.includes("tools/scripts/qualify-vnext.mjs")) {
      await writePassingScorecard(args.at(-1));
    }
  };
  const capture = async (_command, args) => (args[0] === "rev-parse" ? candidate : "");
  const result = await runReleaseQualification(
    { output, collectedAt: "2026-07-21T06:50:00.000Z" },
    { root, run, capture },
  );

  assert.deepEqual(
    commands.map(([command, ...args]) => `${command} ${args.slice(0, 2).join(" ")}`),
    [
      "npm run prepare:vnext-assets",
      "npm run validate:all",
      "npm run qualify:vnext",
      "node tools/scripts/qualify-vnext.mjs --release",
    ],
  );
  assert.equal(result.status, "pass");
  assert.ok(Object.values(result.authorization).every((authorized) => authorized === false));
  await assert.rejects(readFile(join(output, "scorecard", "workspace", "large.tmp")), /ENOENT/);
  const sums = await readFile(join(output, "SHA256SUMS"), "utf8");
  assert.match(sums, /receipt\.json/);
});

test("release qualification fails before commands when tracked source is dirty", async () => {
  let called = false;
  const capture = async (_command, args) => (args[0] === "rev-parse" ? candidate : " M package.json");
  await assert.rejects(
    runReleaseQualification(
      { collectedAt: "2026-07-21T06:50:00.000Z" },
      { root: "/tmp", capture, run: async () => (called = true) },
    ),
    /clean tracked worktree/,
  );
  assert.equal(called, false);
});

test("release qualification rejects a malformed candidate SHA", async () => {
  const capture = async (_command, args) => (args[0] === "rev-parse" ? "ABC123" : "");
  await assert.rejects(
    runReleaseQualification(
      { collectedAt: "2026-07-21T06:50:00.000Z" },
      { root: "/tmp", capture, run: async () => undefined },
    ),
    /exact lowercase SHA/,
  );
});

test("release qualification rejects tracked source drift after commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-release-drift-"));
  let statusCalls = 0;
  const capture = async (_command, args) => {
    if (args[0] === "rev-parse") return candidate;
    statusCalls += 1;
    return statusCalls === 1 ? "" : " M package.json";
  };
  const run = async (_command, args, { log }) => {
    await mkdir(join(log, ".."), { recursive: true });
    await writeFile(log, "pass\n");
    if (args.includes("tools/scripts/qualify-vnext.mjs")) await writePassingScorecard(args.at(-1));
  };
  await assert.rejects(
    runReleaseQualification(
      { output: join(root, "evidence"), collectedAt: "2026-07-21T06:50:00.000Z" },
      { root, capture, run },
    ),
    /changed tracked source files/,
  );
});
