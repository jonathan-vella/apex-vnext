import { canonicalJsonBytes, sha256Bytes } from "@apex/kernel";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface BundledAssetMapping {
  id: string;
  mode: "copy-tree" | "copy-entries" | "compose-json";
  sourceRoot?: string;
  generatedRoot?: string;
  generatedPath?: string;
}

export interface BundledAssetSource {
  kind: "repository-file" | "generated";
  path?: string;
  mapping?: string;
  composition?: string;
}

export interface BundledAssetFile {
  path: string;
  source: BundledAssetSource;
  sha256: string;
  bytes: number;
}

export interface BundledClientProjection {
  id: "github-copilot-cli" | "github-copilot-vscode";
  files: string[];
  digest: string;
}

export interface BundledAssetManifest {
  version: 1;
  sources: { customizations: string; config: string };
  composition: {
    authority: "npm:@apex/cli";
    generator: "packages/cli/scripts/prepare-assets.mjs";
    formatVersion: 1;
    mappings: BundledAssetMapping[];
  };
  projections: BundledClientProjection[];
  files: BundledAssetFile[];
  lock: {
    algorithm: "sha256";
    canonicalization: "apex-bundled-assets-v1";
    digest: string;
  };
}

export interface BundledAssets {
  root: string;
  customizations: string;
  config: string;
  capabilityPacks: string;
  capabilityPackRegistry: string;
  manifest: BundledAssetManifest;
}

const LOCK_DOMAIN = "apex-bundled-assets-v1\0";
const PROJECTION_DOMAIN = "apex-client-projection-v1\0";
const SHA256 = /^[a-f0-9]{64}$/u;

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.includes(":") &&
    !isAbsolute(path) &&
    path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

function assertContained(root: string, path: string): void {
  const child = relative(resolve(root), resolve(path));
  if (child === "" || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error(`Unsafe bundled asset path: ${path}`);
  }
}

export async function readBundledFile(
  root: string,
  relativePath: string,
  beforeOpen: () => Promise<void> = async () => {},
  expectedIdentity?: { dev: bigint; ino: bigint },
): Promise<Buffer> {
  const path = resolve(root, relativePath);
  assertContained(root, path);
  const resolved = await realpath(path);
  assertContained(root, resolved);
  const initialMetadata = await lstat(path, { bigint: true });
  const identity = expectedIdentity ?? { dev: initialMetadata.dev, ino: initialMetadata.ino };
  if (initialMetadata.isSymbolicLink() || !initialMetadata.isFile()) {
    throw new Error(`Unsupported bundled asset entry: ${relativePath}`);
  }
  await beforeOpen();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const descriptorMetadata = await handle.stat({ bigint: true });
    if (!descriptorMetadata.isFile()) throw new Error(`Unsupported bundled asset entry: ${relativePath}`);
    const pathMetadata = await lstat(path, { bigint: true });
    if (
      pathMetadata.isSymbolicLink() ||
      descriptorMetadata.dev !== identity.dev ||
      descriptorMetadata.ino !== identity.ino ||
      pathMetadata.dev !== descriptorMetadata.dev ||
      pathMetadata.ino !== descriptorMetadata.ino
    ) {
      throw new Error(`Bundled asset path changed during verification: ${relativePath}`);
    }
    const descriptorPath = process.platform === "linux" ? `/proc/self/fd/${handle.fd}` : path;
    const openedPath = await realpath(descriptorPath);
    assertContained(root, openedPath);
    if (openedPath !== resolved) {
      throw new Error(`Bundled asset path changed during verification: ${relativePath}`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export function verifyBundleDeclarations(
  manifest: BundledAssetManifest,
  customizationManifest: Record<string, unknown>,
  runtimeBundle: Record<string, unknown>,
): void {
  const bundle = customizationManifest.bundle as Record<string, unknown> | undefined;
  const components = runtimeBundle.components as Record<string, Record<string, unknown>> | undefined;
  const component = components?.customizationBundle;
  const mapping = manifest.composition.mappings.find(({ id }) => id === "customizations");
  if (
    bundle === undefined ||
    component === undefined ||
    bundle.id !== "apex-managed-workspace" ||
    bundle.authority !== manifest.composition.authority ||
    bundle.composition !== mapping?.mode ||
    bundle.sourceRoot !== mapping?.sourceRoot ||
    bundle.generatedRoot !== mapping?.generatedRoot ||
    customizationManifest.version !== manifest.sources.customizations ||
    runtimeBundle.bundleVersion !== manifest.sources.customizations ||
    runtimeBundle.schemaVersion !== manifest.sources.config ||
    component.version !== manifest.sources.customizations ||
    component.manifest !== "@apex/cli/assets/customizations/manifest.json" ||
    component.assetManifest !== "@apex/cli/assets/manifest.json" ||
    component.compositionId !== bundle.id
  ) {
    throw new Error("Bundle composition declarations are inconsistent");
  }
}

export function clientProjectionDigest(
  projection: Pick<BundledClientProjection, "id" | "files">,
  files: BundledAssetFile[],
): string {
  const metadata = new Map(files.map((file) => [file.path, file.sha256]));
  const projectionFiles = projection.files.map((path) => {
    const sha256 = metadata.get(path);
    if (sha256 === undefined) throw new Error(`Client projection references missing asset: ${path}`);
    return { path, sha256 };
  });
  return sha256Bytes(
    Buffer.concat([
      Buffer.from(PROJECTION_DOMAIN, "utf8"),
      canonicalJsonBytes({ id: projection.id, files: projectionFiles }),
    ]),
  );
}

export function bundleLockDigest(
  input: Pick<BundledAssetManifest, "sources" | "composition" | "projections" | "files">,
): string {
  const payload = {
    sources: input.sources,
    composition: input.composition,
    projections: input.projections,
    files: input.files,
  };
  return sha256Bytes(Buffer.concat([Buffer.from(LOCK_DOMAIN, "utf8"), canonicalJsonBytes(payload)]));
}

interface BundledPayloadFile {
  path: string;
  identity: { dev: bigint; ino: bigint };
}

async function bundledPayloadFiles(
  root: string,
  directory = root,
  expectedIdentity?: { dev: bigint; ino: bigint },
): Promise<BundledPayloadFile[]> {
  const before = await lstat(directory, { bigint: true });
  const identity = expectedIdentity ?? { dev: before.dev, ino: before.ino };
  if (!before.isDirectory() || before.isSymbolicLink() || before.dev !== identity.dev || before.ino !== identity.ino) {
    throw new Error(`Bundled asset directory changed during verification: ${portablePath(relative(root, directory))}`);
  }
  const files: BundledPayloadFile[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
    const path = join(directory, entry.name);
    const metadata = await lstat(path, { bigint: true });
    if (metadata.isSymbolicLink())
      throw new Error(`Bundled asset contains a symlink: ${portablePath(relative(root, path))}`);
    if (metadata.isDirectory()) {
      files.push(...(await bundledPayloadFiles(root, path, { dev: metadata.dev, ino: metadata.ino })));
    } else if (metadata.isFile() && portablePath(relative(root, path)) !== "manifest.json") {
      files.push({
        path: portablePath(relative(root, path)),
        identity: { dev: metadata.dev, ino: metadata.ino },
      });
    } else if (!metadata.isFile()) throw new Error(`Unsupported bundled asset entry: ${path}`);
  }
  const after = await lstat(directory, { bigint: true });
  if (!after.isDirectory() || after.isSymbolicLink() || after.dev !== identity.dev || after.ino !== identity.ino) {
    throw new Error(`Bundled asset directory changed during verification: ${portablePath(relative(root, directory))}`);
  }
  return files;
}

export async function verifyBundledAssetManifest(root: string, manifest: BundledAssetManifest): Promise<void> {
  if (
    manifest.version !== 1 ||
    manifest.composition?.authority !== "npm:@apex/cli" ||
    manifest.composition.generator !== "packages/cli/scripts/prepare-assets.mjs" ||
    manifest.composition.formatVersion !== 1 ||
    manifest.lock?.algorithm !== "sha256" ||
    manifest.lock.canonicalization !== "apex-bundled-assets-v1" ||
    typeof manifest.sources?.customizations !== "string" ||
    manifest.sources.customizations.length === 0 ||
    typeof manifest.sources.config !== "string" ||
    manifest.sources.config.length === 0 ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.projections) ||
    !Array.isArray(manifest.composition.mappings)
  ) {
    throw new Error("Unsupported bundled asset manifest");
  }
  const mappings = new Map(manifest.composition.mappings.map((mapping) => [mapping.id, mapping]));
  if (mappings.size !== manifest.composition.mappings.length) throw new Error("Duplicate bundled asset mapping ID");
  const generatedDestinations: string[] = [];
  for (const mapping of mappings.values()) {
    if (!(["copy-tree", "copy-entries", "compose-json"] as const).includes(mapping.mode)) {
      throw new Error(`Invalid bundled asset mapping: ${mapping.id}`);
    }
    if (mapping.mode === "compose-json") {
      if (
        !safeRelativePath(mapping.generatedPath ?? "") ||
        mapping.sourceRoot !== undefined ||
        mapping.generatedRoot !== undefined
      )
        throw new Error(`Invalid bundled asset mapping: ${mapping.id}`);
      generatedDestinations.push(mapping.generatedPath!);
    } else if (
      !safeRelativePath(mapping.sourceRoot ?? "") ||
      !safeRelativePath(mapping.generatedRoot ?? "") ||
      mapping.generatedPath !== undefined
    ) {
      throw new Error(`Invalid bundled asset mapping: ${mapping.id}`);
    } else generatedDestinations.push(`${mapping.generatedRoot}/`);
  }
  for (const [index, destination] of generatedDestinations.entries()) {
    if (
      generatedDestinations.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index && (destination.startsWith(candidate) || candidate.startsWith(destination)),
      )
    )
      throw new Error(`Overlapping bundled asset mapping destination: ${destination}`);
  }
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (!safeRelativePath(file.path)) throw new Error(`Unsafe bundled asset path: ${file.path}`);
    if (paths.has(file.path)) throw new Error(`Duplicate bundled asset path: ${file.path}`);
    paths.add(file.path);
    if (!SHA256.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      throw new Error(`Invalid bundled asset metadata: ${file.path}`);
    }
    if (file.source.kind === "repository-file") {
      const mapping = mappings.get(file.source.mapping ?? "");
      if (
        !safeRelativePath(file.source.path ?? "") ||
        mapping === undefined ||
        mapping.mode === "compose-json" ||
        !file.source.path!.startsWith(`${mapping.sourceRoot}/`) ||
        !file.path.startsWith(`${mapping.generatedRoot}/`) ||
        relative(mapping.sourceRoot!, file.source.path!).split(sep).join("/") !==
          relative(mapping.generatedRoot!, file.path).split(sep).join("/")
      ) {
        throw new Error(`Invalid bundled asset source: ${file.path}`);
      }
    } else if (file.source.kind === "generated") {
      const mapping = mappings.get(file.source.composition ?? "");
      if (mapping?.mode !== "compose-json" || mapping.generatedPath !== file.path) {
        throw new Error(`Invalid bundled asset source: ${file.path}`);
      }
    } else throw new Error(`Invalid bundled asset source: ${file.path}`);
  }
  const projectionIds = new Set<string>();
  for (const projection of manifest.projections) {
    if (
      !["github-copilot-cli", "github-copilot-vscode"].includes(projection.id) ||
      projectionIds.has(projection.id) ||
      !Array.isArray(projection.files) ||
      projection.files.length !== new Set(projection.files).size ||
      projection.files.some((path) => !safeRelativePath(path) || !paths.has(path)) ||
      !SHA256.test(projection.digest) ||
      clientProjectionDigest(projection, manifest.files) !== projection.digest
    ) {
      throw new Error(`Invalid bundled client projection: ${projection.id}`);
    }
    projectionIds.add(projection.id);
  }
  if (projectionIds.size !== 2) throw new Error("Bundled client projections are incomplete");
  const actualFiles = (await bundledPayloadFiles(root)).sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  if (JSON.stringify(actualFiles.map(({ path }) => path)) !== JSON.stringify(manifest.files.map(({ path }) => path))) {
    throw new Error("Bundled asset inventory mismatch");
  }
  const identities = new Map(actualFiles.map(({ path, identity }) => [path, identity]));
  for (const file of manifest.files) {
    const bytes = await readBundledFile(root, file.path, async () => {}, identities.get(file.path));
    if (bytes.byteLength !== file.bytes || sha256Bytes(bytes) !== file.sha256) {
      throw new Error(`Bundled asset hash mismatch: ${file.path}`);
    }
  }
  const customizationManifest = JSON.parse(
    (await readBundledFile(root, "customizations/manifest.json")).toString("utf8"),
  ) as Record<string, unknown>;
  const runtimeBundle = JSON.parse(
    (await readBundledFile(root, "config/runtime-bundle.v1.json")).toString("utf8"),
  ) as Record<string, unknown>;
  verifyBundleDeclarations(manifest, customizationManifest, runtimeBundle);
  const sharedFiles = customizationManifest.sharedFiles as string[];
  const declarations = customizationManifest.clientProjections as Array<{ id: string; files: string[] }>;
  if (
    !Array.isArray(sharedFiles) ||
    sharedFiles.length !== new Set(sharedFiles).size ||
    !Array.isArray(declarations) ||
    declarations.length !== manifest.projections.length ||
    declarations.length !== new Set(declarations.map(({ id }) => id)).size
  ) {
    throw new Error("Client projection declarations are missing");
  }
  for (const declaration of declarations) {
    const projection = manifest.projections.find(({ id }) => id === declaration.id);
    if (!Array.isArray(declaration.files) || declaration.files.length !== new Set(declaration.files).size) {
      throw new Error(`Bundled client projection disagrees with its declaration: ${declaration.id}`);
    }
    const expected = [...sharedFiles, ...declaration.files].map((path) => `customizations/${path}`).sort();
    if (projection === undefined || JSON.stringify(projection.files) !== JSON.stringify(expected)) {
      throw new Error(`Bundled client projection disagrees with its declaration: ${declaration.id}`);
    }
  }
  if (!SHA256.test(manifest.lock.digest) || bundleLockDigest(manifest) !== manifest.lock.digest) {
    throw new Error("Bundled asset lock mismatch");
  }
}

export async function resolveBundledAssets(): Promise<BundledAssets> {
  const root = fileURLToPath(new URL("../assets/", import.meta.url));
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as BundledAssetManifest;
  await verifyBundledAssetManifest(root, manifest);
  return {
    root: dirname(join(root, "manifest.json")),
    customizations: join(root, "customizations"),
    config: join(root, "config"),
    capabilityPacks: join(root, "capability-packs"),
    capabilityPackRegistry: join(root, "capability-packs", "registry.v1.json"),
    manifest,
  };
}
