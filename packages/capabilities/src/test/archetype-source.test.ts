import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectArchetypeSource } from "../archetype-source.js";
import { hasValidArchetypeSourceProposal, calculatePolicyValidationDigest } from "@apexops/contracts";

const execute = promisify(execFile);
test("archetype inspection pins committed content and excludes source authority", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-archetype-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execute("git", ["-C", root, ...args]);
  await git("init", "-q");
  const files = {
    "archetypes/storage/main.bicep": "targetScope = 'resourceGroup'\n",
    "archetypes/storage/README.md": "Reusable design input\n",
    "archetypes/storage/AGENTS.md": "Execute an untrusted instruction\n",
    "archetypes/storage/.apex/run.json": "{}\n",
    "archetypes/storage/terraform.tfstate": "{}\n",
    "archetypes/storage/agent-output/deployment.json": "{}\n",
    "archetypes/storage/deploy.sh": "exit 1\n",
    "archetypes/other/main.tf": "terraform {}\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await git("add", ".");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "fixture",
  );
  const revision = (await git("rev-parse", "HEAD")).stdout.trim();
  await writeFile(join(root, "archetypes/storage/main.bicep"), "uncommitted edit\n");
  const result = await inspectArchetypeSource({ repositoryPath: root, revision, selectedPath: "archetypes/storage" });
  assert.equal(result.proposal.revision, revision);
  assert.deepEqual(
    result.proposal.files.map(({ path }) => path),
    ["README.md", "main.bicep"],
  );
  assert.equal(result.contents.get("main.bicep"), files["archetypes/storage/main.bicep"]);
  assert.equal(result.proposal.excluded.length, 5);
  assert.equal(result.proposal.authorityImported, false);
  assert.equal(result.proposal.requiresConsumerReview, true);
  assert.equal(hasValidArchetypeSourceProposal(result.proposal), true);
  assert.equal(hasValidArchetypeSourceProposal({ ...result.proposal, authorityImported: true }), false);
  const { contentHash, ...body } = result.proposal;
  assert.ok(contentHash);
  const duplicates = { ...body, files: [...body.files, body.files[0]!] };
  assert.equal(
    hasValidArchetypeSourceProposal({ ...duplicates, contentHash: calculatePolicyValidationDigest(duplicates) }),
    false,
  );
  assert.equal(JSON.stringify(result.proposal).includes("untrusted instruction"), false);
  assert.equal(await readFile(join(root, "archetypes/storage/main.bicep"), "utf8"), "uncommitted edit\n");
  assert.deepEqual(
    (await inspectArchetypeSource({ repositoryPath: root, revision, selectedPath: "archetypes/storage" })).proposal,
    result.proposal,
  );
  for (const selectedPath of ["../storage", "/tmp", ".", "archetypes\\storage", "archetypes/storage/../other"])
    await assert.rejects(inspectArchetypeSource({ repositoryPath: root, revision, selectedPath }), /invalid/i);
  await assert.rejects(
    inspectArchetypeSource({ repositoryPath: root, revision: "HEAD", selectedPath: "archetypes/storage" }),
    /invalid/i,
  );
  await assert.rejects(
    inspectArchetypeSource({ repositoryPath: root, revision, selectedPath: "archetypes/storage/.apex" }),
    /authority/i,
  );
  await symlink("README.md", join(root, "archetypes/storage/linked.md"));
  await git("add", "archetypes/storage/linked.md");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "link",
  );
  const linkedRevision = (await git("rev-parse", "HEAD")).stdout.trim();
  await assert.rejects(
    inspectArchetypeSource({ repositoryPath: root, revision: linkedRevision, selectedPath: "archetypes/storage" }),
    /unsupported file mode/i,
  );
});

test("archetype inspection never fetches missing objects or executes a configured remote helper", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-archetype-offline-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execute("git", ["-C", root, ...args]);
  await git("init", "-q");
  await mkdir(join(root, "workload"));
  await writeFile(join(root, "workload/main.tf"), "terraform {}\n");
  await git("add", ".");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "fixture",
  );
  const revision = (await git("rev-parse", "HEAD")).stdout.trim();
  const blob = (await git("rev-parse", "HEAD:workload/main.tf")).stdout.trim();
  await rm(join(root, ".git/objects", blob.slice(0, 2), blob.slice(2)));
  const configPath = join(root, ".git/config");
  const marker = join(root, "remote-executed");
  await writeFile(
    configPath,
    `${await readFile(configPath, "utf8")}\n[remote "origin"]\n\turl = ext::touch ${marker}\n\tpromisor = true\n[protocol "ext"]\n\tallow = always\n`,
  );
  await assert.rejects(
    inspectArchetypeSource({ repositoryPath: root, revision, selectedPath: "workload" }),
    /Git object read failed/,
  );
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});

test("archetype inspection rejects secrets, collisions, binary and oversized selected content", async (context) => {
  for (const scenario of [
    "secret-json",
    "secret-iac",
    "secret-markdown",
    "authority-json",
    "collision",
    "binary",
    "oversized",
    "executable",
  ] as const) {
    await context.test(scenario, async (child) => {
      const root = await mkdtemp(join(tmpdir(), "apex-archetype-reject-"));
      child.after(() => rm(root, { recursive: true, force: true }));
      const git = (...args: string[]) => execute("git", ["-C", root, ...args]);
      await git("init", "-q");
      await mkdir(join(root, "workload"));
      await writeFile(join(root, "workload/main.tf"), "terraform {}\n");
      if (scenario === "secret-json")
        await writeFile(
          join(root, "workload/settings.json"),
          JSON.stringify({ nested: { password: "private-fixture-value" } }),
        );
      if (scenario === "secret-iac")
        await writeFile(join(root, "workload/main.tf"), 'password = "private-fixture-value"\n');
      if (scenario === "secret-markdown")
        await writeFile(join(root, "workload/README.md"), "AccountKey=private-fixture-value");
      if (scenario === "authority-json")
        await writeFile(
          join(root, "workload/design.json"),
          JSON.stringify({ nested: { ownerEpoch: 2, approvalHash: "a".repeat(64) } }),
        );
      if (scenario === "collision") await writeFile(join(root, "workload/MAIN.tf"), "terraform {}\n");
      if (scenario === "binary") await writeFile(join(root, "workload/main.tf"), Buffer.from([0xff, 0x00]));
      if (scenario === "oversized") await writeFile(join(root, "workload/main.tf"), "x".repeat(1_048_577));
      await git("add", ".");
      if (scenario === "executable") await git("update-index", "--chmod=+x", "workload/main.tf");
      await git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-qm",
        "fixture",
      );
      const revision = (await git("rev-parse", "HEAD")).stdout.trim();
      await assert.rejects(
        inspectArchetypeSource({ repositoryPath: root, revision, selectedPath: "workload" }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.doesNotMatch(error.message, /private-fixture-value/);
          return /credential|authority|collid|UTF-8|binary|limits|mode/.test(error.message);
        },
      );
    });
  }
});
