import { AZD_EXACT_TAG_PATTERN, AZD_PUBLIC_BICEP_REGISTRY, type AzdRemoteModuleV1 } from "@apexops/contracts";
import { AzdBindingError } from "./azd-project-files.js";

const EXACT_TAG = new RegExp(AZD_EXACT_TAG_PATTERN, "u");
const REFERENCE =
  /\b(?:module\s+[A-Za-z_]\w*\s+|extension\s+|import\s+|from\s+|using\s+|(?:loadTextContent|loadFileAsBase64|loadJsonContent|loadYamlContent)\(\s*)(['"])([^'"\r\n]*)\1/gu;
const REGISTRY = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/u;
const REPOSITORY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/u;
const SPEC_NAME = /^[A-Za-z0-9][A-Za-z0-9._()-]{0,89}$/u;
const SPEC_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

interface Aliases {
  readonly br: ReadonlyMap<string, { registry: string; modulePath: string }>;
  readonly ts: ReadonlyMap<string, { subscription: string; resourceGroup: string }>;
}

function unpinned(message: string): never {
  throw new AzdBindingError("AZD_MODULE_UNPINNED", message);
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new AzdBindingError("AZD_PROJECT_UNSUPPORTED", `${context} must be an object`);
  return value as Record<string, unknown>;
}

function parseAliases(config: Buffer, file: string): Aliases {
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(config));
  } catch {
    throw new AzdBindingError("AZD_PROJECT_UNSUPPORTED", `${file} must be plain JSON so module aliases can be bound`);
  }
  const aliases = record(document, file).moduleAliases;
  const br = new Map<string, { registry: string; modulePath: string }>();
  const ts = new Map<string, { subscription: string; resourceGroup: string }>();
  if (aliases === undefined) return { br, ts };
  const declared = record(aliases, `${file} moduleAliases`);
  for (const [name, entry] of Object.entries(record(declared.br ?? {}, `${file} moduleAliases.br`))) {
    if (name === "public")
      unpinned(`${file} redefines the built-in br/public alias; remove it so public modules stay on mcr.microsoft.com`);
    const alias = record(entry, `${file} br alias ${name}`);
    const registry = typeof alias.registry === "string" ? alias.registry.toLowerCase() : "";
    const modulePath = typeof alias.modulePath === "string" ? alias.modulePath : "";
    if (!REGISTRY.test(registry) || (modulePath.length > 0 && !REPOSITORY.test(modulePath)))
      unpinned(`${file} br alias ${name} must name a registry and a lowercase module path`);
    br.set(name, { registry, modulePath });
  }
  for (const [name, entry] of Object.entries(record(declared.ts ?? {}, `${file} moduleAliases.ts`))) {
    const alias = record(entry, `${file} ts alias ${name}`);
    const subscription = typeof alias.subscription === "string" ? alias.subscription.toLowerCase() : "";
    const resourceGroup = typeof alias.resourceGroup === "string" ? alias.resourceGroup : "";
    if (!GUID.test(subscription) || resourceGroup.length === 0)
      unpinned(`${file} ts alias ${name} must name a subscription and resource group`);
    ts.set(name, { subscription, resourceGroup });
  }
  return { br, ts };
}

type Parsed = Omit<AzdRemoteModuleV1, "root" | "file" | "reference">;

function parseRegistryReference(reference: string, aliases: Aliases): Parsed {
  const aliasMatch = /^br\/([A-Za-z0-9_-]+):(.*)$/u.exec(reference);
  const plainMatch = /^br:(.*)$/u.exec(reference);
  let registry: string;
  let remainder: string;
  if (aliasMatch !== null) {
    const name = aliasMatch[1]!;
    const resolved =
      name === "public"
        ? { registry: AZD_PUBLIC_BICEP_REGISTRY, modulePath: "bicep" }
        : (aliases.br.get(name) ?? unpinned(`Module reference ${reference} uses the undefined alias br/${name}`));
    registry = resolved.registry;
    remainder = resolved.modulePath.length === 0 ? aliasMatch[2]! : `${resolved.modulePath}/${aliasMatch[2]!}`;
  } else if (plainMatch !== null) {
    const slash = plainMatch[1]!.indexOf("/");
    if (slash <= 0) unpinned(`Module reference ${reference} must name a registry and a repository`);
    registry = plainMatch[1]!.slice(0, slash).toLowerCase();
    remainder = plainMatch[1]!.slice(slash + 1);
  } else return unpinned(`Module reference ${reference} is not a supported br reference`);

  let path: string;
  let pin: Parsed["pin"];
  const digestAt = remainder.indexOf("@");
  if (digestAt >= 0) {
    const digest = /^@sha256:([0-9a-f]{64})$/u.exec(remainder.slice(digestAt));
    if (digest === null) return unpinned(`Module reference ${reference} has a malformed digest; use @sha256:<64 hex>`);
    path = remainder.slice(0, digestAt);
    pin = { type: "digest", value: digest[1]! };
  } else {
    const colon = remainder.lastIndexOf(":");
    if (colon <= 0 || colon === remainder.length - 1)
      return unpinned(`Module reference ${reference} has no tag; pin an exact x.y.z tag or an @sha256 digest`);
    path = remainder.slice(0, colon);
    const tag = remainder.slice(colon + 1);
    if (!EXACT_TAG.test(tag))
      return unpinned(
        `Module reference ${reference} uses the floating tag '${tag.slice(0, 32)}'; pin an exact x.y.z tag or an @sha256 digest`,
      );
    if (registry !== AZD_PUBLIC_BICEP_REGISTRY || !path.startsWith("bicep/"))
      return unpinned(
        `Module reference ${reference} is outside the Microsoft public registry, where tags are not immutable; pin an @sha256 digest`,
      );
    pin = { type: "tag", value: tag };
  }
  if (!REGISTRY.test(registry) || !REPOSITORY.test(path))
    return unpinned(`Module reference ${reference} has an invalid registry or repository name`);
  return { kind: "br", registry, path, pin };
}

function parseTemplateSpec(reference: string, aliases: Aliases): Parsed {
  const aliasMatch = /^ts\/([A-Za-z0-9_-]+):([^:]+):([^:]+)$/u.exec(reference);
  const plainMatch = /^ts:([0-9A-Fa-f-]{36})\/([^/:]+)\/([^/:]+):([^:]+)$/u.exec(reference);
  let subscription: string;
  let resourceGroup: string;
  let name: string;
  let version: string;
  if (aliasMatch !== null) {
    const alias =
      aliases.ts.get(aliasMatch[1]!) ??
      unpinned(`Module reference ${reference} uses the undefined alias ts/${aliasMatch[1]!}`);
    ({ subscription, resourceGroup } = alias);
    name = aliasMatch[2]!;
    version = aliasMatch[3]!;
  } else if (plainMatch !== null) {
    subscription = plainMatch[1]!.toLowerCase();
    [resourceGroup, name, version] = [plainMatch[2]!, plainMatch[3]!, plainMatch[4]!];
  } else
    return unpinned(`Template spec reference ${reference} must name a subscription, resource group, spec and version`);
  if (!GUID.test(subscription) || !SPEC_NAME.test(name) || !SPEC_VERSION.test(version))
    return unpinned(`Template spec reference ${reference} has an invalid subscription, name or version`);
  return {
    kind: "ts",
    registry: `${subscription}/${resourceGroup}`,
    path: name,
    pin: { type: "version", value: version },
  };
}

/** Local references must stay inside the bound tree; only an existing project file can be hashed. */
function assertLocal(root: string, file: string, reference: string): void {
  if (/^(?:[\\/]|[A-Za-z]:)/u.test(reference) || reference.split(/[\\/]/u).includes(".."))
    throw new AzdBindingError("AZD_PATH_UNSAFE", `Infra ${root} file ${file} references a file outside its bound tree`);
}

/**
 * Inventories the remote Bicep modules and template specs in one infrastructure root and refuses every reference that
 * is not immutable. `files` maps tree-relative paths to content, including each `bicepconfig.json` that can define
 * module aliases for the files beneath it.
 */
export function inventoryBicepReferences(
  root: { readonly name: string; readonly path: string },
  files: ReadonlyMap<string, Buffer>,
): AzdRemoteModuleV1[] {
  const configs = new Map<string, Aliases>();
  const aliasesFor = (file: string): Aliases => {
    const segments = file.split("/").slice(0, -1);
    for (let depth = segments.length; depth >= 0; depth--) {
      const candidate = [...segments.slice(0, depth), "bicepconfig.json"].join("/");
      const content = files.get(candidate);
      if (content === undefined) continue;
      let aliases = configs.get(candidate);
      if (aliases === undefined) {
        aliases = parseAliases(content, `${root.path}/${candidate}`);
        configs.set(candidate, aliases);
      }
      return aliases;
    }
    throw new AzdBindingError("AZD_INFRA_MISSING", `Infra ${root.name} needs ${root.path}/bicepconfig.json`);
  };
  // Every configuration in the tree must parse and be free of redefined built-in aliases, used or not.
  for (const path of files.keys())
    if (path.endsWith("bicepconfig.json")) aliasesFor(path.replace(/bicepconfig\.json$/u, "x"));
  const modules: AzdRemoteModuleV1[] = [];
  for (const [path, content] of [...files].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    if (!path.endsWith(".bicep")) continue;
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new AzdBindingError("AZD_INFRA_MISSING", `Infra ${root.name} file ${path} is not valid UTF-8`);
    }
    const file = `${root.path}/${path}`;
    const seen = new Set<string>();
    for (const match of source.matchAll(REFERENCE)) {
      const reference = match[2]!;
      if (seen.has(reference)) continue;
      seen.add(reference);
      if (/^(?:br|ts)[:/]/u.test(reference)) {
        const parsed = reference.startsWith("br")
          ? parseRegistryReference(reference, aliasesFor(path))
          : parseTemplateSpec(reference, aliasesFor(path));
        modules.push({ root: root.name, file, reference, ...parsed });
      } else if (
        /^[a-z][a-z0-9+.-]+:/iu.test(reference) &&
        !/^(?:az|microsoftgraph|kubernetes)[@:]/iu.test(reference)
      ) {
        unpinned(
          `Infra ${root.name} file ${file} references ${reference.slice(0, 48)}, which cannot be pinned; use a br: reference with an exact tag or digest`,
        );
      } else assertLocal(root.name, file, reference);
    }
  }
  return modules;
}
