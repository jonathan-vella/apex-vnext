import assert from "node:assert/strict";
import { mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { sha256Bytes } from "@apex/kernel";
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
  await mkdir(join(root, "customizations", ".github"), { recursive: true });
  await mkdir(join(root, "customizations", ".vscode"), { recursive: true });
  const bytes = Buffer.from('{"schemaVersion":"1.0.0"}\n', "utf8");
  const sharedBytes = Buffer.from("shared\n", "utf8");
  const cliBytes = Buffer.from('{"mcpServers":{}}\n', "utf8");
  const vscodeBytes = Buffer.from('{"servers":{}}\n', "utf8");
  await writeFile(join(root, "config", "example.json"), bytes);
  const customizationBytes = Buffer.from(
    `${JSON.stringify({
      version: "0.10.0",
      bundle: {
        id: "apex-managed-workspace",
        authority: "npm:@apex/cli",
        composition: "copy-tree",
        sourceRoot: "customizations",
        generatedRoot: "customizations",
      },
      sharedFiles: ["README.md"],
      clientProjections: [
        { id: "github-copilot-vscode", files: [".vscode/mcp.json"] },
        { id: "github-copilot-cli", files: [".github/mcp.json"] },
      ],
    })}\n`,
  );
  const runtimeBytes = Buffer.from(
    `${JSON.stringify({
      schemaVersion: "1.0.0",
      bundleVersion: "0.10.0",
      components: {
        customizationBundle: {
          version: "0.10.0",
          manifest: "@apex/cli/assets/customizations/manifest.json",
          assetManifest: "@apex/cli/assets/manifest.json",
          compositionId: "apex-managed-workspace",
        },
      },
    })}\n`,
  );
  await writeFile(join(root, "customizations", "manifest.json"), customizationBytes);
  await writeFile(join(root, "customizations", "README.md"), sharedBytes);
  await writeFile(join(root, "customizations", ".github", "mcp.json"), cliBytes);
  await writeFile(join(root, "customizations", ".vscode", "mcp.json"), vscodeBytes);
  await writeFile(join(root, "config", "runtime-bundle.v1.json"), runtimeBytes);
  const sources = { customizations: "0.10.0", config: "1.0.0" };
  const composition = {
    authority: "npm:@apex/cli" as const,
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
    ],
  };
  const files = [
    {
      path: "config/example.json",
      source: { kind: "repository-file" as const, path: "config/example.json", mapping: "config" },
      sha256: sha256Bytes(bytes),
      bytes: bytes.byteLength,
    },
    {
      path: "config/runtime-bundle.v1.json",
      source: {
        kind: "repository-file" as const,
        path: "config/runtime-bundle.v1.json",
        mapping: "config",
      },
      sha256: sha256Bytes(runtimeBytes),
      bytes: runtimeBytes.byteLength,
    },
    {
      path: "customizations/.github/mcp.json",
      source: {
        kind: "repository-file" as const,
        path: "customizations/.github/mcp.json",
        mapping: "customizations",
      },
      sha256: sha256Bytes(cliBytes),
      bytes: cliBytes.byteLength,
    },
    {
      path: "customizations/.vscode/mcp.json",
      source: {
        kind: "repository-file" as const,
        path: "customizations/.vscode/mcp.json",
        mapping: "customizations",
      },
      sha256: sha256Bytes(vscodeBytes),
      bytes: vscodeBytes.byteLength,
    },
    {
      path: "customizations/README.md",
      source: {
        kind: "repository-file" as const,
        path: "customizations/README.md",
        mapping: "customizations",
      },
      sha256: sha256Bytes(sharedBytes),
      bytes: sharedBytes.byteLength,
    },
    {
      path: "customizations/manifest.json",
      source: {
        kind: "repository-file" as const,
        path: "customizations/manifest.json",
        mapping: "customizations",
      },
      sha256: sha256Bytes(customizationBytes),
      bytes: customizationBytes.byteLength,
    },
  ];
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const projections = [
    {
      id: "github-copilot-cli" as const,
      files: ["customizations/.github/mcp.json", "customizations/README.md"],
      digest: "",
    },
    {
      id: "github-copilot-vscode" as const,
      files: ["customizations/.vscode/mcp.json", "customizations/README.md"],
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
      source: { mapping: file.source.mapping, path: file.source.path, kind: file.source.kind },
      path: file.path,
    })),
    composition: {
      mappings: manifest.composition.mappings.map((mapping) => ({
        generatedRoot: mapping.generatedRoot,
        sourceRoot: mapping.sourceRoot,
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

  const falseSource = structuredClone(manifest);
  falseSource.files[0]!.source.path = "config/other.json";
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
