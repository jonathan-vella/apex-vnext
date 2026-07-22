#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const assetsRoot = join(packageRoot, "assets");
const LOCK_DOMAIN = "apex-bundled-assets-v1\0";
const PROJECTION_DOMAIN = "apex-client-projection-v1\0";

function bytewise(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portablePath(path) {
  return path.split(sep).join("/");
}

function assertContained(root, path) {
  const child = relative(root, path);
  if (child === "" || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error(`Unsafe asset path: ${path}`);
  }
}

export function canonicalJson(value, ancestors = new Set()) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not support non-finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError(`Canonical JSON does not support ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError("Canonical JSON does not support cyclic values");
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) result = `[${value.map((item) => canonicalJson(item, ancestors)).join(",")}]`;
  else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON only supports plain objects");
    }
    result = `{${Object.keys(value)
      .sort(bytewise)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`)
      .join(",")}}`;
  }
  ancestors.delete(value);
  return result;
}

export async function readSourceFile(resolvedRoot, path, beforeOpen = async () => {}, expectedIdentity) {
  const resolvedPath = await realpath(path);
  assertContained(resolvedRoot, resolvedPath);
  const initialMetadata = await lstat(path, { bigint: true });
  const identity = expectedIdentity ?? { dev: initialMetadata.dev, ino: initialMetadata.ino };
  if (initialMetadata.isSymbolicLink() || !initialMetadata.isFile()) {
    throw new Error(`Unsupported asset source entry: ${path}`);
  }
  await beforeOpen();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const descriptorMetadata = await handle.stat({ bigint: true });
    if (!descriptorMetadata.isFile()) throw new Error(`Unsupported asset source entry: ${path}`);
    const pathMetadata = await lstat(path, { bigint: true });
    if (
      pathMetadata.isSymbolicLink() ||
      descriptorMetadata.dev !== identity.dev ||
      descriptorMetadata.ino !== identity.ino ||
      pathMetadata.dev !== descriptorMetadata.dev ||
      pathMetadata.ino !== descriptorMetadata.ino
    ) {
      throw new Error(`Asset source path changed during generation: ${path}`);
    }
    const descriptorPath = process.platform === "linux" ? `/proc/self/fd/${handle.fd}` : path;
    const openedPath = await realpath(descriptorPath);
    assertContained(resolvedRoot, openedPath);
    if (openedPath !== resolvedPath) {
      throw new Error(`Asset source path changed during generation: ${path}`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function pinSourceRoot(path, beforeResolve = async () => {}) {
  const before = await lstat(path, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink())
    throw new Error(`Asset source must be a real directory: ${path}`);
  await beforeResolve();
  const resolvedRoot = await realpath(path);
  const after = await lstat(path, { bigint: true });
  if (!after.isDirectory() || after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino) {
    throw new Error(`Asset source directory changed during generation: ${path}`);
  }
  return { resolvedRoot, identity: { dev: before.dev, ino: before.ino } };
}

export function validateBundleDeclarations(customizationManifest, runtimeBundle) {
  const bundle = customizationManifest.bundle;
  const component = runtimeBundle.components?.customizationBundle;
  if (
    typeof customizationManifest.version !== "string" ||
    customizationManifest.version.length === 0 ||
    typeof runtimeBundle.bundleVersion !== "string" ||
    runtimeBundle.bundleVersion.length === 0 ||
    typeof runtimeBundle.schemaVersion !== "string" ||
    runtimeBundle.schemaVersion.length === 0 ||
    typeof component?.version !== "string" ||
    component.version.length === 0 ||
    bundle?.id !== "apex-managed-workspace" ||
    bundle.authority !== "npm:@apex/cli" ||
    bundle.composition !== "copy-tree" ||
    bundle.sourceRoot !== "customizations" ||
    bundle.generatedRoot !== "customizations" ||
    customizationManifest.version !== runtimeBundle.bundleVersion ||
    component?.version !== customizationManifest.version ||
    component?.manifest !== "@apex/cli/assets/customizations/manifest.json" ||
    component.assetManifest !== "@apex/cli/assets/manifest.json" ||
    component.compositionId !== bundle.id
  ) {
    throw new Error("Bundle composition declarations are inconsistent");
  }
  return bundle;
}

async function walkFiles(root, directory = root, expectedIdentity) {
  const before = await lstat(directory, { bigint: true });
  const identity = expectedIdentity ?? { dev: before.dev, ino: before.ino };
  if (!before.isDirectory() || before.isSymbolicLink() || before.dev !== identity.dev || before.ino !== identity.ino) {
    throw new Error(`Asset source directory changed during generation: ${directory}`);
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => bytewise(left.name, right.name))) {
    const path = join(directory, entry.name);
    assertContained(root, path);
    const metadata = await lstat(path, { bigint: true });
    if (metadata.isSymbolicLink()) throw new Error(`Asset source contains a symlink: ${path}`);
    if (metadata.isDirectory()) {
      files.push(...(await walkFiles(root, path, { dev: metadata.dev, ino: metadata.ino })));
    } else if (metadata.isFile()) files.push({ path, identity: { dev: metadata.dev, ino: metadata.ino } });
    else throw new Error(`Unsupported asset source entry: ${path}`);
  }
  const after = await lstat(directory, { bigint: true });
  if (!after.isDirectory() || after.isSymbolicLink() || after.dev !== identity.dev || after.ino !== identity.ino) {
    throw new Error(`Asset source directory changed during generation: ${directory}`);
  }
  return files;
}

async function fileDigest(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function treeDigest(root) {
  const hash = createHash("sha256");
  const visit = async (directory) => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      bytewise(left.name, right.name),
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const name = portablePath(relative(root, path));
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new Error(`Asset source contains a symlink: ${path}`);
      hash.update(metadata.isDirectory() ? `d:${name}\0` : `f:${name}\0`);
      if (metadata.isDirectory()) await visit(path);
      else if (metadata.isFile()) hash.update(await readFile(path));
      else throw new Error(`Unsupported asset source entry: ${path}`);
    }
  };
  await visit(root);
  return hash.digest("hex");
}

async function copyEntry(sourceRoot, pinnedRoot, destinationRoot, sourceRelative, mapping, inventory) {
  const sourceRootMetadata = await lstat(sourceRoot, { bigint: true });
  if (
    !sourceRootMetadata.isDirectory() ||
    sourceRootMetadata.isSymbolicLink() ||
    sourceRootMetadata.dev !== pinnedRoot.identity.dev ||
    sourceRootMetadata.ino !== pinnedRoot.identity.ino
  ) {
    throw new Error(`Asset source directory changed during generation: ${sourceRoot}`);
  }
  const source = join(sourceRoot, sourceRelative);
  const metadata = await lstat(source, { bigint: true });
  if (metadata.isSymbolicLink()) throw new Error(`Asset source contains a symlink: ${source}`);
  const files = metadata.isDirectory()
    ? await walkFiles(source, source, { dev: metadata.dev, ino: metadata.ino })
    : [{ path: source, identity: { dev: metadata.dev, ino: metadata.ino } }];
  for (const sourceFile of files) {
    const destinationRelative = metadata.isDirectory()
      ? join(sourceRelative, relative(source, sourceFile.path))
      : sourceRelative;
    const destination = join(destinationRoot, destinationRelative);
    assertContained(destinationRoot, destination);
    await mkdir(dirname(destination), { recursive: true });
    const bytes = await readSourceFile(pinnedRoot.resolvedRoot, sourceFile.path, async () => {}, sourceFile.identity);
    await writeFile(destination, bytes);
    inventory.push({
      path: portablePath(relative(assetsRoot, destination)),
      source: {
        kind: "repository-file",
        path: portablePath(relative(repositoryRoot, sourceFile.path)),
        mapping,
      },
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
    });
  }
}

async function prepareCapabilityPacks(inventory) {
  const policy = JSON.parse(await readFile(join(repositoryRoot, "config", "capability-packs.v1.json"), "utf8"));
  const definitions = new Map(policy.packs.map((pack) => [pack.id, pack]));
  const packsRoot = join(assetsRoot, "capability-packs");
  const sources = [
    {
      id: "azure-pricing",
      root: join(repositoryRoot, "tools", "mcp-servers", "azure-pricing"),
      entries: ["pyproject.toml", "uv.lock", "src"],
    },
    {
      id: "azure-governance-discovery",
      root: join(repositoryRoot, ".github", "skills", "azure-governance-discovery"),
      entries: [join("scripts", "discover.py"), join("scripts", "render_governance.py")],
    },
    {
      id: "drawio",
      root: join(repositoryRoot, "tools", "mcp-servers", "drawio"),
      entries: ["deno.json", "deno.lock", "src", join("assets", "azure-public-service-icons")],
    },
  ];
  for (const source of sources) {
    const pinnedRoot = await pinSourceRoot(source.root);
    const destination = join(packsRoot, source.id, "source");
    for (const entry of source.entries) {
      await copyEntry(source.root, pinnedRoot, destination, entry, source.id, inventory);
    }
  }

  const emptyDigest = createHash("sha256").update("").digest("hex");
  const pricingSource = join(packsRoot, "azure-pricing", "source");
  const governanceSource = join(packsRoot, "azure-governance-discovery", "source");
  const drawioSource = join(packsRoot, "drawio", "source");
  const pricingPyproject = await readFile(join(pricingSource, "pyproject.toml"), "utf8");
  const pricingVersion = pricingPyproject.match(/^version\s*=\s*"([^"]+)"/mu)?.[1];
  if (pricingVersion === undefined) throw new Error("Azure pricing version is missing from pyproject.toml");
  const drawioConfig = JSON.parse(await readFile(join(drawioSource, "deno.json"), "utf8"));
  const uvDigest = await fileDigest(join(pricingSource, "uv.lock"));
  const denoDigest = await fileDigest(join(drawioSource, "deno.lock"));
  const governanceScriptDigest = await fileDigest(join(governanceSource, "scripts", "discover.py"));
  const metadata = (id) => {
    const definition = definitions.get(id);
    if (definition === undefined) throw new Error(`Capability pack metadata is missing for ${id}`);
    return definition;
  };
  const registry = {
    schemaVersion: policy.schemaVersion,
    protocolVersion: policy.protocolVersion,
    installationPolicy: policy.installationPolicy,
    packs: [
      {
        ...metadata("azure-pricing"),
        version: pricingVersion,
        runtime: "python",
        artifact: {
          type: "local-directory",
          spec: "capability-packs/azure-pricing/source",
          digest: await treeDigest(pricingSource),
        },
        lock: {
          installer: "uv",
          path: "capability-packs/azure-pricing/source/uv.lock",
          digest: uvDigest,
          directDigest: uvDigest,
          transitiveDigest: uvDigest,
        },
        executable: { command: "uv", args: ["run", "--frozen", "--no-dev", "azure-pricing-mcp"] },
        capabilities: ["azure-pricing"],
      },
      {
        ...metadata("azure-governance-discovery"),
        version: "1.0.0",
        runtime: "python",
        artifact: {
          type: "local-directory",
          spec: "capability-packs/azure-governance-discovery/source",
          digest: await treeDigest(governanceSource),
        },
        lock: {
          installer: "pip-hashes",
          digest: emptyDigest,
          directDigest: emptyDigest,
          transitiveDigest: emptyDigest,
        },
        executable: { command: "python", args: ["scripts/discover.py"] },
        dependencyFree: true,
        script: "scripts/discover.py",
        scriptDigest: governanceScriptDigest,
        capabilities: ["governance-discovery"],
      },
      {
        ...metadata("drawio"),
        version: typeof drawioConfig.version === "string" ? drawioConfig.version : "1.0.0",
        runtime: "deno",
        artifact: {
          type: "local-directory",
          spec: "capability-packs/drawio/source",
          digest: await treeDigest(drawioSource),
        },
        lock: {
          installer: "deno",
          path: "capability-packs/drawio/source/deno.lock",
          digest: denoDigest,
          directDigest: denoDigest,
          transitiveDigest: denoDigest,
        },
        executable: { command: "deno", args: ["run", "--frozen", "-P", "src/index.ts", "--transport", "stdio"] },
        capabilities: ["drawio"],
      },
    ],
  };
  const registryPath = join(packsRoot, "registry.v1.json");
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  const registryBytes = await readFile(registryPath);
  inventory.push({
    path: portablePath(relative(assetsRoot, registryPath)),
    source: { kind: "generated", composition: "capability-pack-registry" },
    sha256: createHash("sha256").update(registryBytes).digest("hex"),
    bytes: registryBytes.byteLength,
  });
}

async function prepareAssets() {
  const customizationManifest = JSON.parse(
    await readFile(join(repositoryRoot, "customizations", "manifest.json"), "utf8"),
  );
  const runtimeBundle = JSON.parse(await readFile(join(repositoryRoot, "config", "runtime-bundle.v1.json"), "utf8"));
  const bundleDeclaration = validateBundleDeclarations(customizationManifest, runtimeBundle);
  const sourceRoots = [
    { name: "customizations", root: join(repositoryRoot, "customizations") },
    { name: "config", root: join(repositoryRoot, "config") },
  ];
  const sources = await Promise.all(
    sourceRoots.map(async (source) => ({ ...source, pinnedRoot: await pinSourceRoot(source.root) })),
  );
  const inventory = [];
  await rm(assetsRoot, { recursive: true, force: true });
  await mkdir(assetsRoot, { recursive: true });

  for (const source of sources) {
    for (const sourceFile of await walkFiles(source.root, source.root, {
      dev: source.pinnedRoot.identity.dev,
      ino: source.pinnedRoot.identity.ino,
    })) {
      const sourceRelative = relative(source.root, sourceFile.path);
      const destination = join(assetsRoot, source.name, sourceRelative);
      assertContained(join(assetsRoot, source.name), destination);
      await mkdir(dirname(destination), { recursive: true });
      const bytes = await readSourceFile(
        source.pinnedRoot.resolvedRoot,
        sourceFile.path,
        async () => {},
        sourceFile.identity,
      );
      await writeFile(destination, bytes);
      inventory.push({
        path: portablePath(relative(assetsRoot, destination)),
        source: {
          kind: "repository-file",
          path: portablePath(relative(repositoryRoot, sourceFile.path)),
          mapping: source.name,
        },
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      });
    }
  }

  await prepareCapabilityPacks(inventory);

  const sourcesMetadata = {
    customizations: customizationManifest.version,
    config: runtimeBundle.schemaVersion,
  };
  const composition = {
    authority: "npm:@apex/cli",
    generator: "packages/cli/scripts/prepare-assets.mjs",
    formatVersion: 1,
    mappings: [
      {
        id: "customizations",
        mode: bundleDeclaration.composition,
        sourceRoot: bundleDeclaration.sourceRoot,
        generatedRoot: bundleDeclaration.generatedRoot,
      },
      { id: "config", mode: "copy-tree", sourceRoot: "config", generatedRoot: "config" },
      {
        id: "azure-pricing",
        mode: "copy-entries",
        sourceRoot: "tools/mcp-servers/azure-pricing",
        generatedRoot: "capability-packs/azure-pricing/source",
      },
      {
        id: "azure-governance-discovery",
        mode: "copy-entries",
        sourceRoot: ".github/skills/azure-governance-discovery",
        generatedRoot: "capability-packs/azure-governance-discovery/source",
      },
      {
        id: "drawio",
        mode: "copy-entries",
        sourceRoot: "tools/mcp-servers/drawio",
        generatedRoot: "capability-packs/drawio/source",
      },
      { id: "capability-pack-registry", mode: "compose-json", generatedPath: "capability-packs/registry.v1.json" },
    ],
  };
  const files = inventory.sort((left, right) => bytewise(left.path, right.path));
  const paths = new Set(files.map(({ path }) => path));
  if (paths.size !== files.length) throw new Error("Bundled asset generator produced duplicate destination paths");
  const sharedFiles = customizationManifest.sharedFiles;
  const clientProjections = customizationManifest.clientProjections;
  if (!Array.isArray(sharedFiles) || !Array.isArray(clientProjections)) {
    throw new Error("Client projection declarations are missing");
  }
  const fileMetadata = new Map(files.map((file) => [file.path, file]));
  const projections = clientProjections
    .map((projection) => {
      const projectionFiles = [...sharedFiles, ...(projection.files ?? [])]
        .map((path) => `customizations/${path}`)
        .sort(bytewise);
      const digestInput = projectionFiles.map((path) => {
        const file = fileMetadata.get(path);
        if (file === undefined) throw new Error(`Client projection references missing asset: ${path}`);
        return { path, sha256: file.sha256 };
      });
      return {
        id: projection.id,
        files: projectionFiles,
        digest: createHash("sha256")
          .update(`${PROJECTION_DOMAIN}${canonicalJson({ id: projection.id, files: digestInput })}`)
          .digest("hex"),
      };
    })
    .sort((left, right) => bytewise(left.id, right.id));
  if (projections.length !== new Set(projections.map(({ id }) => id)).size) {
    throw new Error("Client projection declarations contain duplicate IDs");
  }
  const lockInput = { sources: sourcesMetadata, composition, projections, files };
  const manifest = {
    version: 1,
    ...lockInput,
    lock: {
      algorithm: "sha256",
      canonicalization: "apex-bundled-assets-v1",
      digest: createHash("sha256")
        .update(`${LOCK_DOMAIN}${canonicalJson(lockInput)}`)
        .digest("hex"),
    },
  };
  await writeFile(join(assetsRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await prepareAssets();
