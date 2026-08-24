#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const assetsRoot = join(packageRoot, "assets");
const LOCK_DOMAIN = "apex-bundled-assets-v1\0";
const PROJECTION_DOMAIN = "apex-client-projection-v1\0";
const CLIENT_ADAPTER_VERSION = "1.1.0";
const PROJECTION_TARGETS = new Map([
  ["github-copilot-vscode", "vscode"],
  ["github-copilot-cli", "github-copilot"],
]);

function bytewise(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portablePath(path) {
  return path.split(sep).join("/");
}

function safeRelativePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.includes(":") &&
    !isAbsolute(path) &&
    path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

function parseAgentSource(source) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(source.replaceAll("\r\n", "\n"));
  if (match === null) throw new Error("Agent source must contain YAML frontmatter");
  const frontmatter = loadYaml(match[1]);
  if (frontmatter === null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    throw new Error("Agent frontmatter must be an object");
  }
  return { frontmatter, body: match[2].replace(/^\n/u, "") };
}

function serializeAgent(frontmatter, mechanics, body) {
  return `---\n${dumpYaml(frontmatter, {
    noRefs: true,
    lineWidth: 120,
    noCompatMode: true,
    quotingType: '"',
  })}---\n\n${mechanics}<!-- apex-shared-body -->\n${body}`;
}

export function renderClientAgentProjection(source, clientId, toolInventory, options = {}) {
  const { frontmatter, body } = parseAgentSource(source);
  if ("target" in frontmatter) throw new Error("Shared agent source must not declare target");
  if (clientId === "github-copilot-vscode") {
    const mechanics = [
      Array.isArray(frontmatter.tools) && frontmatter.tools.includes("vscode/askQuestions")
        ? "Use `vscode/askQuestions` for kernel-owned input requests."
        : null,
      Array.isArray(frontmatter.handoffs) && frontmatter.handoffs.length > 0
        ? "Use the declared direct handoffs for interactive transitions."
        : null,
    ].filter(Boolean);
    return serializeAgent(
      { ...frontmatter, target: "vscode" },
      mechanics.length === 0 ? "" : `## Client Mechanics\n\n${mechanics.join(" ")}\n\n`,
      body,
    );
  }
  if (clientId !== "github-copilot-cli") throw new Error(`Unsupported client projection: ${clientId}`);
  const inventory = toolInventory ?? {
    interactiveTools: { askUser: "ask_user", delegate: "task" },
    workspaceServer: "apex",
    operationIds: ["status", "recordInput"],
  };
  const model = Array.isArray(frontmatter.model) ? frontmatter.model[0] : frontmatter.model;
  if (typeof model !== "string" || model.length === 0) throw new Error("CLI agent projection requires one model");
  const sourceTools = Array.isArray(frontmatter.tools) ? frontmatter.tools : [];
  const tools = [
    ...new Set(
      sourceTools.map((tool) => {
        if (tool === "vscode/askQuestions") return inventory.interactiveTools.askUser;
        if (tool === "agent") return inventory.interactiveTools.delegate;
        if (typeof tool === "string" && tool.startsWith("apex/")) {
          const operation = tool.slice("apex/".length);
          if (!inventory.operationIds.includes(operation)) throw new Error(`Unpinned CLI APEX operation: ${operation}`);
          return `${inventory.workspaceServer}/${operation}`;
        }
        return tool;
      }),
    ),
  ];
  if (options.delegates === true && !tools.includes(inventory.interactiveTools.delegate)) {
    tools.push(inventory.interactiveTools.delegate);
  }
  const cliFrontmatter = {
    name: frontmatter.name,
    description: frontmatter.description,
    target: "github-copilot",
    model,
    "user-invocable": frontmatter["user-invocable"] ?? true,
    "disable-model-invocation": frontmatter["disable-model-invocation"] ?? frontmatter["user-invocable"] === false,
    tools,
  };
  const mechanics = [
    tools.includes(inventory.interactiveTools.askUser)
      ? `Use \`${inventory.interactiveTools.askUser}\` for kernel-owned input requests.`
      : null,
    tools.includes(inventory.interactiveTools.delegate)
      ? `Use \`${inventory.interactiveTools.delegate}\` for declared worker delegation.`
      : null,
  ].filter(Boolean);
  return serializeAgent(
    cliFrontmatter,
    mechanics.length === 0 ? "" : `## Client Mechanics\n\n${mechanics.join(" ")}\n\n`,
    body,
  );
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
    bundle.authority !== "npm:@apexops/cli" ||
    bundle.composition !== "copy-tree" ||
    bundle.sourceRoot !== "customizations" ||
    bundle.generatedRoot !== "customizations" ||
    customizationManifest.version !== runtimeBundle.bundleVersion ||
    component?.version !== customizationManifest.version ||
    component?.manifest !== "@apexops/cli/assets/customizations/manifest.json" ||
    component.assetManifest !== "@apexops/cli/assets/manifest.json" ||
    component.compositionId !== bundle.id
  ) {
    throw new Error("Bundle composition declarations are inconsistent");
  }
  return bundle;
}

export function validateClientProjectionDeclarations(customizationManifest) {
  const sharedFiles = customizationManifest.sharedFiles;
  const sharedDirectories = customizationManifest.sharedDirectories ?? [];
  const clientProjections = customizationManifest.clientProjections;
  const roles = customizationManifest.roles;
  if (
    !Array.isArray(sharedFiles) ||
    sharedFiles.some((path) => typeof path !== "string") ||
    sharedFiles.length !== new Set(sharedFiles).size ||
    !Array.isArray(sharedDirectories) ||
    sharedDirectories.some((path) => typeof path !== "string" || !safeRelativePath(path)) ||
    sharedDirectories.length !== new Set(sharedDirectories).size ||
    !Array.isArray(clientProjections) ||
    clientProjections.some(
      (projection) =>
        projection === null ||
        typeof projection !== "object" ||
        typeof projection.id !== "string" ||
        !safeRelativePath(projection.generatedRoot) ||
        !projection.generatedRoot.startsWith(`client-projections/${projection.id}`) ||
        !Array.isArray(projection.files) ||
        projection.files.some((path) => !safeRelativePath(path)) ||
        projection.files.length !== new Set(projection.files).size,
    ) ||
    clientProjections.length !== new Set(clientProjections.map(({ id }) => id)).size ||
    !Array.isArray(roles) ||
    roles.some(
      (role) =>
        role === null ||
        typeof role !== "object" ||
        typeof role.id !== "string" ||
        !safeRelativePath(role.source) ||
        typeof role.agent !== "string" ||
        !Array.isArray(role.supportedTargets) ||
        role.supportedTargets.length === 0 ||
        role.supportedTargets.length > PROJECTION_TARGETS.size ||
        new Set(role.supportedTargets).size !== role.supportedTargets.length ||
        role.supportedTargets.some((target) => ![...PROJECTION_TARGETS.values()].includes(target)),
    ) ||
    roles.length !== new Set(roles.map(({ id }) => id)).size ||
    roles.length !== new Set(roles.map(({ source }) => source)).size ||
    roles.length !== new Set(roles.map(({ agent }) => agent)).size
  ) {
    throw new Error("Client projection declarations are invalid");
  }
  return { sharedFiles, sharedDirectories, clientProjections, roles };
}

export function roleSupportsClient(role, clientId) {
  const projectionTarget = PROJECTION_TARGETS.get(clientId);
  if (projectionTarget === undefined) throw new Error(`Unsupported client projection: ${clientId}`);
  return role.supportedTargets.includes(projectionTarget);
}

export function roleDelegatesOnClient(role, clientId, roles, invocationEdges) {
  return invocationEdges.some(
    ({ from, to }) =>
      from === role.agent &&
      roles.some(({ agent, supportedTargets }) => roleSupportsClient({ supportedTargets }, clientId) && agent === to),
  );
}

function validateCliToolInventory(value) {
  const maintenanceAllowlist = ["bash", "view", "glob", "rg", "apply_patch"];
  const maintenanceDenylist = [
    "ask_user",
    "task",
    "skill",
    "web_fetch",
    "fetch_copilot_cli_documentation",
    "session_store_sql",
    "sql",
    "list_agents",
    "read_agent",
    "write_agent",
    "list_bash",
    "read_bash",
    "stop_bash",
  ];
  if (
    value?.schemaVersion !== "1.1.0" ||
    value.client !== "github-copilot-cli" ||
    value.characterizationVersion !== "1.0.77" ||
    !/^[a-f0-9]{64}$/u.test(value.characterizationBinarySha256 ?? "") ||
    !/^[a-f0-9]{64}$/u.test(value.characterizationPayloadSha256 ?? "") ||
    value.workspaceServer !== "apex" ||
    JSON.stringify(value.nativeTools?.maintenanceAllowlist) !== JSON.stringify(maintenanceAllowlist) ||
    JSON.stringify(value.nativeTools?.maintenanceDenylist) !== JSON.stringify(maintenanceDenylist) ||
    value.nativeTools?.permissionPatterns?.commands !== "shell(<authorized-command-prefix>:*)" ||
    value.nativeTools?.permissionPatterns?.writes !== "write(<authorized-absolute-path>)" ||
    value.interactiveTools?.askUser !== "ask_user" ||
    value.interactiveTools?.delegate !== "task" ||
    value.mcpSelectorFormat !== "{server}/{operation}" ||
    !Array.isArray(value.operationIds) ||
    value.operationIds.length !== new Set(value.operationIds).size ||
    !Array.isArray(value.verifiedSelectors) ||
    value.verifiedSelectors.length !== value.operationIds.length ||
    value.operationIds.some((operation) => !value.verifiedSelectors.includes(`apex/${operation}`)) ||
    !/^[a-f0-9]{64}$/u.test(value.evidence?.probeSha256 ?? "")
  ) {
    throw new Error("Copilot CLI agent tool inventory is invalid");
  }
  return value;
}

async function prepareClientProjections(customizationManifest, pinnedCustomizations, inventory) {
  const { sharedFiles, sharedDirectories, clientProjections, roles } =
    validateClientProjectionDeclarations(customizationManifest);
  const toolInventoryPath = join(repositoryRoot, "tools", "registry", "copilot-cli-agent-tools.json");
  const toolInventory = validateCliToolInventory(JSON.parse(await readFile(toolInventoryPath, "utf8")));
  const metadataDestination = join(assetsRoot, "client-projection-metadata", "copilot-cli-agent-tools.json");
  await mkdir(dirname(metadataDestination), { recursive: true });
  const metadataBytes = await readFile(toolInventoryPath);
  await writeFile(metadataDestination, metadataBytes);
  inventory.push({
    path: portablePath(relative(assetsRoot, metadataDestination)),
    source: {
      kind: "repository-file",
      path: "tools/registry/copilot-cli-agent-tools.json",
      mapping: "copilot-cli-tool-inventory",
    },
    sha256: createHash("sha256").update(metadataBytes).digest("hex"),
    bytes: metadataBytes.byteLength,
  });

  const sharedDirectoryFiles = [];
  for (const directory of sharedDirectories) {
    const sourceDirectory = join(repositoryRoot, "customizations", directory);
    const metadata = await lstat(sourceDirectory, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Shared client projection directory is invalid: ${directory}`);
    }
    for (const file of await walkFiles(sourceDirectory, sourceDirectory, { dev: metadata.dev, ino: metadata.ino })) {
      sharedDirectoryFiles.push(portablePath(join(directory, relative(sourceDirectory, file.path))));
    }
  }

  for (const projection of clientProjections) {
    const generatedRoot = join(assetsRoot, projection.generatedRoot);
    assertContained(assetsRoot, generatedRoot);
    const roleSources = new Set(
      roles.filter((role) => roleSupportsClient(role, projection.id)).map(({ source }) => source),
    );
    const sources = [...new Set([...sharedFiles, ...sharedDirectoryFiles, ...projection.files])].filter(
      (path) => !roleSources.has(path),
    );
    for (const relativePath of sources) {
      const bytes = await readSourceFile(
        pinnedCustomizations.resolvedRoot,
        join(repositoryRoot, "customizations", relativePath),
      );
      const sourceHash = createHash("sha256").update(bytes).digest("hex");
      const destination = join(generatedRoot, relativePath);
      assertContained(generatedRoot, destination);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
      inventory.push({
        path: portablePath(relative(assetsRoot, destination)),
        source: {
          kind: "generated",
          composition: "client-projections",
          clientId: projection.id,
          target: relativePath,
          adapterVersion: CLIENT_ADAPTER_VERSION,
          sourcePath: relativePath,
          sourceHash,
        },
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      });
    }
    for (const role of roles) {
      if (!roleSupportsClient(role, projection.id)) continue;
      const sourcePath = join(repositoryRoot, "customizations", role.source);
      const source = (await readSourceFile(pinnedCustomizations.resolvedRoot, sourcePath)).toString("utf8");
      const sourceHash = createHash("sha256").update(source).digest("hex");
      const delegates = roleDelegatesOnClient(role, projection.id, roles, customizationManifest.invocationEdges);
      const rendered = Buffer.from(
        renderClientAgentProjection(source, projection.id, toolInventory, { delegates }),
        "utf8",
      );
      const destination = join(generatedRoot, role.source);
      assertContained(generatedRoot, destination);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, rendered);
      inventory.push({
        path: portablePath(relative(assetsRoot, destination)),
        source: {
          kind: "generated",
          composition: "client-projections",
          roleId: role.id,
          sourcePath: role.source,
          sourceHash,
          clientId: projection.id,
          target: role.source,
          adapterVersion: CLIENT_ADAPTER_VERSION,
        },
        sha256: createHash("sha256").update(rendered).digest("hex"),
        bytes: rendered.byteLength,
      });
    }
  }
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
      id: "azure-governance-discovery",
      root: join(repositoryRoot, ".github", "skills", "azure-governance-discovery"),
      entries: [join("scripts", "discover.py"), join("scripts", "render_governance.py")],
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
  const governanceSource = join(packsRoot, "azure-governance-discovery", "source");
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
  validateClientProjectionDeclarations(customizationManifest);
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

  await prepareClientProjections(
    customizationManifest,
    sources.find(({ name }) => name === "customizations").pinnedRoot,
    inventory,
  );
  await prepareCapabilityPacks(inventory);

  const sourcesMetadata = {
    customizations: customizationManifest.version,
    config: runtimeBundle.schemaVersion,
  };
  const composition = {
    authority: "npm:@apexops/cli",
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
        id: "copilot-cli-tool-inventory",
        mode: "copy-entries",
        sourceRoot: "tools/registry",
        generatedRoot: "client-projection-metadata",
      },
      {
        id: "client-projections",
        mode: "render-client-projections",
        sourceRoot: "customizations",
        generatedRoot: "client-projections",
      },
      {
        id: "azure-governance-discovery",
        mode: "copy-entries",
        sourceRoot: ".github/skills/azure-governance-discovery",
        generatedRoot: "capability-packs/azure-governance-discovery/source",
      },
      { id: "capability-pack-registry", mode: "compose-json", generatedPath: "capability-packs/registry.v1.json" },
    ],
  };
  const files = inventory.sort((left, right) => bytewise(left.path, right.path));
  const paths = new Set(files.map(({ path }) => path));
  if (paths.size !== files.length) throw new Error("Bundled asset generator produced duplicate destination paths");
  const { clientProjections } = validateClientProjectionDeclarations(customizationManifest);
  const fileMetadata = new Map(files.map((file) => [file.path, file]));
  const projections = clientProjections
    .map((projection) => {
      const projectionFiles = files
        .map(({ path }) => path)
        .filter((path) => path.startsWith(`${projection.generatedRoot}/`))
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
