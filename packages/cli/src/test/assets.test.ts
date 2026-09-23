import assert from "node:assert/strict";
import { mkdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { sha256Bytes } from "@apexops/kernel";
import {
  bundleLockDigest,
  clientProjectionDigest,
  readBundledFile,
  verifyBundledAssetManifest,
  type BundledAssetManifest,
} from "../assets.js";
import { tempRoot } from "./helpers.js";

async function fixture(): Promise<{ root: string; manifest: BundledAssetManifest }> {
  const root = await tempRoot();
  await mkdir(join(root, "config"), { recursive: true });
  await mkdir(join(root, "customizations", ".github", "agents"), { recursive: true });
  await mkdir(join(root, "client-projections", "github-copilot-cli", ".github", "agents"), { recursive: true });
  const bytes = Buffer.from('{"schemaVersion":"1.0.0"}\n', "utf8");
  const sharedBytes = Buffer.from("shared\n", "utf8");
  const mcpBytes = Buffer.from('{"mcpServers":{}}\n', "utf8");
  const agentBytes = Buffer.from("---\nname: APEX\ndescription: Test\n---\n\nBody\n", "utf8");
  await writeFile(join(root, "config", "example.json"), bytes);
  const customizationBytes = Buffer.from(
    `${JSON.stringify({
      version: "0.10.0-next.5",
      bundle: {
        id: "apex-managed-workspace",
        authority: "npm:@apexops/cli",
        composition: "copy-tree",
        sourceRoot: "customizations",
        generatedRoot: "customizations",
      },
      sharedFiles: ["README.md"],
      clientProjections: [
        {
          id: "github-copilot-cli",
          generatedRoot: "client-projections/github-copilot-cli",
          files: [".mcp.json"],
        },
      ],
      roles: [
        {
          id: "coordinator",
          source: ".github/agents/apex.agent.md",
          agent: "APEX",
          supportedTargets: ["github-copilot"],
        },
      ],
    })}\n`,
  );
  const runtimeBytes = Buffer.from(
    `${JSON.stringify({
      schemaVersion: "1.0.0",
      bundleVersion: "0.10.0-next.5",
      components: {
        customizationBundle: {
          version: "0.10.0-next.5",
          manifest: "@apexops/cli/assets/customizations/manifest.json",
          assetManifest: "@apexops/cli/assets/manifest.json",
          compositionId: "apex-managed-workspace",
        },
      },
    })}\n`,
  );
  await writeFile(join(root, "customizations", "manifest.json"), customizationBytes);
  await writeFile(join(root, "customizations", "README.md"), sharedBytes);
  await writeFile(join(root, "customizations", ".mcp.json"), mcpBytes);
  await writeFile(join(root, "customizations", ".github", "agents", "apex.agent.md"), agentBytes);
  const projectionRoot = join(root, "client-projections", "github-copilot-cli");
  await writeFile(join(projectionRoot, ".mcp.json"), mcpBytes);
  await writeFile(join(projectionRoot, ".github", "agents", "apex.agent.md"), agentBytes);
  await writeFile(join(projectionRoot, "README.md"), sharedBytes);
  await writeFile(join(root, "config", "runtime-bundle.v1.json"), runtimeBytes);
  const sources = { customizations: "0.10.0-next.5", config: "1.0.0" };
  const composition = {
    authority: "npm:@apexops/cli" as const,
    generator: "packages/cli/scripts/prepare-assets.mjs" as const,
    formatVersion: 1 as const,
    mappings: [
      {
        id: "config",
        mode: "copy-tree" as const,
        sourceRoot: "config",
        generatedRoot: "config",
      },
      {
        id: "customizations",
        mode: "copy-tree" as const,
        sourceRoot: "customizations",
        generatedRoot: "customizations",
      },
      {
        id: "client-projections",
        mode: "render-client-projections" as const,
        sourceRoot: "customizations",
        generatedRoot: "client-projections",
      },
    ],
  };
  const repositoryFile = (path: string, mapping: string, content: Buffer): BundledAssetManifest["files"][number] => ({
    path,
    source: { kind: "repository-file", path, mapping },
    sha256: sha256Bytes(content),
    bytes: content.byteLength,
  });
  const files: BundledAssetManifest["files"] = [
    repositoryFile("customizations/.github/agents/apex.agent.md", "customizations", agentBytes),
    repositoryFile("config/example.json", "config", bytes),
    repositoryFile("config/runtime-bundle.v1.json", "config", runtimeBytes),
    repositoryFile("customizations/.mcp.json", "customizations", mcpBytes),
    repositoryFile("customizations/README.md", "customizations", sharedBytes),
    repositoryFile("customizations/manifest.json", "customizations", customizationBytes),
  ];
  for (const [target, content] of [
    [".mcp.json", mcpBytes],
    [".github/agents/apex.agent.md", agentBytes],
    ["README.md", sharedBytes],
  ] as const) {
    const agent = target === ".github/agents/apex.agent.md";
    files.push({
      path: `client-projections/github-copilot-cli/${target}`,
      source: {
        kind: "generated",
        composition: "client-projections",
        clientId: "github-copilot-cli",
        target,
        adapterVersion: "1.6.0",
        sourcePath: target,
        sourceHash: sha256Bytes(content),
        ...(agent ? { roleId: "coordinator" } : {}),
      },
      sha256: sha256Bytes(content),
      bytes: content.byteLength,
    });
  }
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const projections: BundledAssetManifest["projections"] = [
    {
      id: "github-copilot-cli",
      files: files.filter(({ path }) => path.startsWith("client-projections/")).map(({ path }) => path),
      digest: "",
    },
  ];
  for (const projection of projections) projection.digest = clientProjectionDigest(projection, files);
  const lockInput = { sources, composition, projections, files };
  return {
    root,
    manifest: {
      version: 1,
      sources,
      composition,
      projections,
      files,
      lock: {
        algorithm: "sha256",
        canonicalization: "apex-bundled-assets-v1",
        digest: bundleLockDigest(lockInput),
      },
    },
  };
}

test("verifies a complete source-mapped bundle manifest", async (context) => {
  const { root, manifest } = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await verifyBundledAssetManifest(root, manifest);
});

test("rejects retired VS Code and combined projections after rehashing", async (context) => {
  const { root, manifest } = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const relabelled = structuredClone(manifest);
  const agent = relabelled.files.find(
    ({ path }) => path.endsWith(".github/agents/apex.agent.md") && path.startsWith("client-projections/"),
  )!;
  agent.source.clientId = "github-copilot-vscode";
  relabelled.lock.digest = bundleLockDigest(relabelled);
  await assert.rejects(verifyBundledAssetManifest(root, relabelled), /Invalid generated client projection provenance/);
  const combined = structuredClone(manifest);
  combined.projections.push({ ...combined.projections[0]!, id: "both" as never });
  combined.lock.digest = bundleLockDigest(combined);
  await assert.rejects(verifyBundledAssetManifest(root, combined), /Invalid bundled client projection: both/);
});

test("rejects aggregate lock tampering and unlisted payload files", async (context) => {
  const { root, manifest } = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    verifyBundledAssetManifest(root, { ...manifest, lock: { ...manifest.lock, digest: "0".repeat(64) } }),
    /lock mismatch/,
  );
  await writeFile(join(root, "config", "unlisted.json"), "{}\n");
  await assert.rejects(verifyBundledAssetManifest(root, manifest), /inventory mismatch/);
});

test("rejects duplicate and unsafe asset paths", async (context) => {
  const { root, manifest } = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const duplicate = { ...manifest, files: [...manifest.files, manifest.files[0]!] };
  duplicate.lock = { ...duplicate.lock, digest: bundleLockDigest(duplicate) };
  await assert.rejects(verifyBundledAssetManifest(root, duplicate), /Duplicate bundled asset path/);
  const unsafe = structuredClone(manifest);
  unsafe.files[0]!.path = "../outside.json";
  unsafe.lock.digest = bundleLockDigest(unsafe);
  await assert.rejects(verifyBundledAssetManifest(root, unsafe), /Unsafe bundled asset path/);
  const windowsTraversal = structuredClone(manifest);
  windowsTraversal.files[0]!.path = "..\\outside.json";
  windowsTraversal.lock.digest = bundleLockDigest(windowsTraversal);
  await assert.rejects(verifyBundledAssetManifest(root, windowsTraversal), /Unsafe bundled asset path/);
});

test("canonical lock ignores object insertion order", async (context) => {
  const { root, manifest } = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const reordered = {
    files: manifest.files.map((file) => ({
      bytes: file.bytes,
      sha256: file.sha256,
      source: Object.fromEntries(Object.entries(file.source).reverse()) as typeof file.source,
      path: file.path,
    })),
    composition: {
      mappings: manifest.composition.mappings.map((mapping) => ({
        ...(mapping.generatedRoot === undefined ? {} : { generatedRoot: mapping.generatedRoot }),
        ...(mapping.generatedPath === undefined ? {} : { generatedPath: mapping.generatedPath }),
        ...(mapping.sourceRoot === undefined ? {} : { sourceRoot: mapping.sourceRoot }),
        mode: mapping.mode,
        id: mapping.id,
      })),
      formatVersion: manifest.composition.formatVersion,
      generator: manifest.composition.generator,
      authority: manifest.composition.authority,
    },
    projections: manifest.projections.map((projection) => ({
      digest: projection.digest,
      files: projection.files,
      id: projection.id,
    })),
    sources: { config: manifest.sources.config, customizations: manifest.sources.customizations },
  } as Pick<BundledAssetManifest, "sources" | "composition" | "projections" | "files">;
  assert.equal(bundleLockDigest(reordered), manifest.lock.digest);
});

test("rejects client projection digest and declaration drift after aggregate rebaselining", async (context) => {
  const { root, manifest } = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const digestDrift = structuredClone(manifest);
  digestDrift.projections[0]!.digest = "0".repeat(64);
  digestDrift.lock.digest = bundleLockDigest(digestDrift);
  await assert.rejects(verifyBundledAssetManifest(root, digestDrift), /Invalid bundled client projection/);

  const adapterDrift = structuredClone(manifest);
  adapterDrift.files.find(
    ({ source }) => source.kind === "generated" && source.composition === "client-projections",
  )!.source.adapterVersion = "1.3.0";
  adapterDrift.lock.digest = bundleLockDigest(adapterDrift);
  await assert.rejects(
    verifyBundledAssetManifest(root, adapterDrift),
    /Invalid generated client projection provenance/,
  );

  const declarationDrift = structuredClone(manifest);
  const declarationPath = join(root, "customizations", "manifest.json");
  const declaration = JSON.parse(
    await import("node:fs/promises").then(({ readFile }) => readFile(declarationPath, "utf8")),
  );
  declaration.clientProjections[0].files = [".github/mcp.json"];
  const changed = Buffer.from(`${JSON.stringify(declaration)}\n`);
  await writeFile(declarationPath, changed);
  const entry = declarationDrift.files.find(({ path }) => path === "customizations/manifest.json")!;
  entry.sha256 = sha256Bytes(changed);
  entry.bytes = changed.byteLength;
  declarationDrift.lock.digest = bundleLockDigest(declarationDrift);
  await assert.rejects(verifyBundledAssetManifest(root, declarationDrift), /disagrees with its declaration/);

  declaration.clientProjections.pop();
  const incomplete = Buffer.from(`${JSON.stringify(declaration)}\n`);
  await writeFile(declarationPath, incomplete);
  entry.sha256 = sha256Bytes(incomplete);
  entry.bytes = incomplete.byteLength;
  declarationDrift.lock.digest = bundleLockDigest(declarationDrift);
  await assert.rejects(verifyBundledAssetManifest(root, declarationDrift), /declarations are missing/);
});

test("rejects a generated role in an unsupported client projection", async (context) => {
  const { root, manifest } = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const changedManifest = structuredClone(manifest);
  const declarationPath = join(root, "customizations", "manifest.json");
  const declaration = JSON.parse(
    await import("node:fs/promises").then(({ readFile }) => readFile(declarationPath, "utf8")),
  );
  declaration.roles[0].supportedTargets = ["vscode"];
  const changed = Buffer.from(`${JSON.stringify(declaration)}\n`);
  await writeFile(declarationPath, changed);
  const entry = changedManifest.files.find(({ path }) => path === "customizations/manifest.json")!;
  entry.sha256 = sha256Bytes(changed);
  entry.bytes = changed.byteLength;
  changedManifest.lock.digest = bundleLockDigest(changedManifest);
  await assert.rejects(verifyBundledAssetManifest(root, changedManifest), /source binding mismatch/);
});

test("rejects unknown client projection IDs before target-dependent binding", async (context) => {
  const { root, manifest } = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const changedManifest = structuredClone(manifest);
  const generated = changedManifest.files.find(
    ({ source }) => source.kind === "generated" && source.roleId === "coordinator",
  )!;
  generated.source.clientId = "unknown-client";
  changedManifest.lock.digest = bundleLockDigest(changedManifest);
  await assert.rejects(
    verifyBundledAssetManifest(root, changedManifest),
    /Invalid generated client projection provenance/,
  );
  generated.source.clientId = "github-copilot-cli";

  const declarationPath = join(root, "customizations", "manifest.json");
  const declaration = JSON.parse(
    await import("node:fs/promises").then(({ readFile }) => readFile(declarationPath, "utf8")),
  );
  declaration.clientProjections[0].id = "unknown-client";
  const changed = Buffer.from(`${JSON.stringify(declaration)}\n`);
  await writeFile(declarationPath, changed);
  const entry = changedManifest.files.find(({ path }) => path === "customizations/manifest.json")!;
  entry.sha256 = sha256Bytes(changed);
  entry.bytes = changed.byteLength;
  changedManifest.lock.digest = bundleLockDigest(changedManifest);
  await assert.rejects(verifyBundledAssetManifest(root, changedManifest), /Unsupported bundled client projection/);
});

test("rejects symlinks and false source mapping provenance", async (context) => {
  const { root, manifest } = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await symlink("example.json", join(root, "config", "linked.json"));
  const linked = structuredClone(manifest);
  linked.files.push({
    ...linked.files[0]!,
    path: "config/linked.json",
    source: { kind: "repository-file", path: "config/linked.json", mapping: "config" },
  });
  linked.lock.digest = bundleLockDigest(linked);
  await assert.rejects(verifyBundledAssetManifest(root, linked), /contains a symlink/);
  await unlink(join(root, "config", "linked.json"));

  const falseSource = structuredClone(manifest);
  const falseSourceEntry = falseSource.files.find(({ path }) => path === "config/example.json")!;
  if (falseSourceEntry.source.kind !== "repository-file") throw new Error("Expected repository source fixture");
  falseSourceEntry.source.path = "config/other.json";
  falseSource.lock.digest = bundleLockDigest(falseSource);
  await assert.rejects(verifyBundledAssetManifest(root, falseSource), /Invalid bundled asset source/);

  const parallelEscape = structuredClone(manifest);
  const example = parallelEscape.files.find(({ path }) => path === "config/example.json")!;
  example.path = "customizations/example.json";
  example.source.path = "customizations/example.json";
  parallelEscape.files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  parallelEscape.lock.digest = bundleLockDigest(parallelEscape);
  await assert.rejects(verifyBundledAssetManifest(root, parallelEscape), /Invalid bundled asset source/);
});

test("runtime verifier refuses a parent directory replaced before open", async (context) => {
  const root = await tempRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const parent = join(root, "parent");
  const moved = join(root, "moved");
  await mkdir(parent);
  await writeFile(join(parent, "value.txt"), "expected\n");
  await assert.rejects(
    readBundledFile(root, "parent/value.txt", async () => {
      await rename(parent, moved);
      await mkdir(parent);
      await writeFile(join(parent, "value.txt"), "outside\n");
    }),
    /changed during verification/,
  );
});

test("rejects bundle declaration drift", async (context) => {
  const { root, manifest } = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const changed = Buffer.from('{"version":"0.10.0","bundle":{"id":"other"}}\n');
  await writeFile(join(root, "customizations", "manifest.json"), changed);
  const entry = manifest.files.find(({ path }) => path === "customizations/manifest.json")!;
  entry.sha256 = sha256Bytes(changed);
  entry.bytes = changed.byteLength;
  manifest.lock.digest = bundleLockDigest(manifest);
  await assert.rejects(verifyBundledAssetManifest(root, manifest), /declarations are inconsistent/);
});

test("rejects overlapping mapping destinations", async (context) => {
  const { root, manifest } = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const overlapping = structuredClone(manifest);
  overlapping.composition.mappings.push({
    id: "nested",
    mode: "copy-tree",
    sourceRoot: "nested",
    generatedRoot: "config/nested",
  });
  overlapping.lock.digest = bundleLockDigest(overlapping);
  await assert.rejects(verifyBundledAssetManifest(root, overlapping), /Overlapping bundled asset mapping destination/);
});

test("rejects unknown mapping modes and missing signed source versions", async (context) => {
  const { root, manifest } = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  const unknownMode = structuredClone(manifest);
  unknownMode.composition.mappings[0]!.mode = "unknown-mode" as "copy-tree";
  unknownMode.lock.digest = bundleLockDigest(unknownMode);
  await assert.rejects(verifyBundledAssetManifest(root, unknownMode), /Invalid bundled asset mapping/);

  const missingVersion = structuredClone(manifest);
  missingVersion.sources.config = "";
  missingVersion.lock.digest = bundleLockDigest(missingVersion);
  await assert.rejects(verifyBundledAssetManifest(root, missingVersion), /Unsupported bundled asset manifest/);
});

test("compares inventory in global bytewise path order", async (context) => {
  const { root, manifest } = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "config", "a"), { recursive: true });
  await writeFile(join(root, "config", "a", "child.json"), "{}\n");
  await writeFile(join(root, "config", "a.txt"), "text\n");
  for (const path of ["config/a.txt", "config/a/child.json"]) {
    const bytes = Buffer.from(path.endsWith(".txt") ? "text\n" : "{}\n", "utf8");
    manifest.files.push({
      path,
      source: { kind: "repository-file", path, mapping: "config" },
      sha256: sha256Bytes(bytes),
      bytes: bytes.byteLength,
    });
  }
  manifest.files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  manifest.lock.digest = bundleLockDigest(manifest);
  await verifyBundledAssetManifest(root, manifest);
});
