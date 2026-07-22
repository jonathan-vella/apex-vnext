import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  canonicalJson,
  pinSourceRoot,
  readSourceFile,
  validateBundleDeclarations,
} from "../../../packages/cli/scripts/prepare-assets.mjs";

test("asset generator canonical JSON ignores object insertion order", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: true, x: "value" } }),
    canonicalJson({ a: { x: "value", y: true }, z: 1 }),
  );
});

test("asset generator refuses a source replaced by a symlink before open", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-asset-source-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.txt");
  const outside = join(root, "outside.txt");
  await writeFile(source, "expected\n");
  await writeFile(outside, "outside\n");

  await assert.rejects(
    readSourceFile(root, source, async () => {
      await unlink(source);
      await symlink(outside, source);
    }),
    /ELOOP|symbolic link|symlink/iu,
  );
});

test("asset generator refuses a parent directory replaced before open", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-asset-parent-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const parent = join(root, "parent");
  const moved = join(root, "moved");
  await mkdir(parent);
  await writeFile(join(parent, "source.txt"), "expected\n");
  await assert.rejects(
    readSourceFile(root, join(parent, "source.txt"), async () => {
      await rename(parent, moved);
      await mkdir(parent);
      await writeFile(join(parent, "source.txt"), "outside\n");
    }),
    /changed during generation/,
  );
});

test("asset generator refuses a source root replaced before pinning completes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-asset-root-"));
  const moved = `${root}-moved`;
  context.after(() => rm(root, { recursive: true, force: true }));
  context.after(() => rm(moved, { recursive: true, force: true }));
  await assert.rejects(
    pinSourceRoot(root, async () => {
      await rename(root, moved);
      await mkdir(root);
    }),
    /directory changed during generation/,
  );
});

test("asset generator rejects inconsistent bundle declarations", () => {
  const customization = {
    version: "0.10.0",
    bundle: {
      id: "apex-managed-workspace",
      authority: "npm:@apex/cli",
      composition: "copy-tree",
      sourceRoot: "customizations",
      generatedRoot: "customizations",
    },
  };
  const runtime = {
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
  };
  assert.equal(validateBundleDeclarations(customization, runtime).authority, "npm:@apex/cli");
  const missingVersions = structuredClone(runtime);
  delete missingVersions.schemaVersion;
  assert.throws(() => validateBundleDeclarations(customization, missingVersions), /declarations are inconsistent/);
  runtime.components.customizationBundle.compositionId = "other";
  assert.throws(() => validateBundleDeclarations(customization, runtime), /declarations are inconsistent/);
});
