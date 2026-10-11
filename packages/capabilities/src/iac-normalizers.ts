import type { DeploymentPreviewV1 } from "@apexops/contracts";

export type NormalizedPreview = Pick<DeploymentPreviewV1, "changes" | "blockers"> & {
  readonly stateLineage?: string;
  readonly stateSerial?: number;
};

export class IacOutputParseError extends Error {
  constructor(
    public readonly source: "azd-preview" | "azure-read" | "bicep-build" | "terraform-plan" | "terraform-state",
    message: string,
  ) {
    super(message);
    this.name = "IacOutputParseError";
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseJsonProcessOutput(source: IacOutputParseError["source"], stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new IacOutputParseError(source, `Invalid ${source} JSON output: ${reason}`);
  }
}

/** The ARM resource type and name an `azd provision --preview` entry would carry, derived from a resource ID. */
function azdIdentity(resourceId: string): string | undefined {
  const marker = resourceId.toLowerCase().lastIndexOf("/providers/");
  if (marker === -1) return undefined;
  const segments = resourceId.slice(marker + "/providers/".length).split("/");
  if (segments.length < 3 || segments.length % 2 === 0) return undefined;
  const types = [segments[0]!];
  const names: string[] = [];
  for (let index = 1; index < segments.length; index += 2) {
    types.push(segments[index]!);
    names.push(segments[index + 1]!);
  }
  return `${types.join("/")}\u0000${names.join("/")}`.toLowerCase();
}

function azdPreviewEnvelopes(stdout: string): unknown[] {
  const envelopes: unknown[] = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    const envelope = object(event);
    // azd --output json writes one event per line; the preview is the only console event whose data is a list
    // (null when nothing would change).
    if (envelope?.type === "consoleMessage" && (Array.isArray(envelope.data) || envelope.data === null)) {
      envelopes.push(envelope.data);
    }
  }
  return envelopes;
}

/**
 * Normalizes the output of `azd provision --preview --output json`. azd prints newline-delimited console events; the
 * preview event carries `{ Operation, Type, Name, PropertyDeltas }` per resource and no resource ID, so each change is
 * resolved to an accepted resource ID by ARM type and name. A change that cannot be resolved keeps an unresolved
 * identity and, when material, blocks the preview.
 */
export function normalizeAzdPreview(
  stdout: string,
  accepted: readonly { readonly resourceId: string }[],
): NormalizedPreview {
  const previews = azdPreviewEnvelopes(stdout);
  if (previews.length !== 1) {
    throw new IacOutputParseError(
      "azd-preview",
      previews.length === 0
        ? "azd did not print a provisioning preview event"
        : "azd printed more than one provisioning preview event",
    );
  }
  const raw = previews[0] === null ? [] : (previews[0] as unknown[]);
  const byIdentity = new Map<string, string | null>();
  for (const { resourceId } of accepted) {
    const identity = azdIdentity(resourceId);
    if (identity === undefined) continue;
    byIdentity.set(identity, byIdentity.has(identity) ? null : resourceId);
  }
  const blockers: string[] = [];
  const changes: DeploymentPreviewV1["changes"] = raw.map((entry, index) => {
    const change = object(entry);
    const type = text(change?.Type);
    const name = text(change?.Name);
    const rawType = text(change?.Operation) ?? "Unknown";
    if (change === undefined || type === undefined || name === undefined) {
      blockers.push(`azd preview change ${index} is malformed`);
    }
    const identity = `${type ?? ""}\u0000${name ?? ""}`.toLowerCase();
    const resolved = byIdentity.get(identity);
    const resourceId = resolved ?? `azd-unresolved:${type ?? "unknown"}/${name ?? index}`;
    const normalized = rawType.toLowerCase().replaceAll(/[^a-z]/g, "");
    const action =
      normalized === "create"
        ? "create"
        : normalized === "modify" || normalized === "deploy"
          ? "update"
          : normalized === "delete"
            ? "delete"
            : normalized === "nochange" || normalized === "ignore"
              ? "no-op"
              : "unknown";
    if (action === "unknown") {
      blockers.push(`azd preview returned unsupported or unevaluated change '${rawType}' for '${type}/${name}'`);
    } else if (action !== "no-op" && (resolved === undefined || resolved === null)) {
      blockers.push(
        `azd preview reports a ${action} of '${type}/${name}' that does not resolve to exactly one accepted resource`,
      );
    }
    return {
      resourceId,
      action,
      material: action !== "no-op",
      details: `azd operation: ${rawType}`,
    };
  });
  const materialIds = changes.filter(({ material }) => material).map(({ resourceId }) => resourceId.toLowerCase());
  for (const duplicate of new Set(materialIds.filter((id, index) => materialIds.indexOf(id) !== index))) {
    blockers.push(`azd preview contains duplicate material resource '${duplicate}'`);
  }
  return { changes, blockers };
}

export function normalizeTerraformPlan(value: unknown): NormalizedPreview {
  const root = object(value);
  if (root === undefined) {
    throw new IacOutputParseError("terraform-plan", "Terraform plan output must be a JSON object");
  }
  const blockers: string[] = [];
  if (root.resource_changes !== undefined && !Array.isArray(root.resource_changes)) {
    blockers.push("Terraform resource_changes must be an array when present");
  }
  if (root.complete === false) blockers.push("Terraform plan is incomplete");
  if (root.complete !== undefined && typeof root.complete !== "boolean") {
    blockers.push("Terraform plan completeness is malformed");
  }
  if (root.errored !== undefined && typeof root.errored !== "boolean") {
    blockers.push("Terraform plan error status is malformed");
  }
  if (root.deferred_changes !== undefined && !Array.isArray(root.deferred_changes)) {
    blockers.push("Terraform deferred changes are malformed");
  }
  const changes: DeploymentPreviewV1["changes"] = array(root.resource_changes).map((entry, index) => {
    const resource = object(entry);
    const change = object(resource?.change);
    if (resource === undefined || change === undefined || !Array.isArray(change?.actions)) {
      blockers.push(`Terraform resource change ${index} is malformed`);
    }
    const rawActions = array(change?.actions);
    const validActions = rawActions.length > 0 && rawActions.every((action) => typeof action === "string");
    const actions = validActions ? (rawActions as string[]) : [];
    if (!validActions) blockers.push(`Terraform resource change ${index} has malformed actions`);
    const resourceId = text(resource?.address) ?? `unknown-terraform-resource-${index}`;
    const signature = actions.join(",");
    const action =
      signature === "create"
        ? "create"
        : signature === "update"
          ? "update"
          : signature === "delete"
            ? "delete"
            : signature === "no-op" || signature === "read"
              ? "no-op"
              : signature === "delete,create" || signature === "create,delete"
                ? "replace"
                : "unknown";
    if (action === "unknown") {
      blockers.push(
        `Terraform returned unsupported or unevaluated actions '${signature || "missing"}' for '${resourceId}'`,
      );
    }
    if (action !== "no-op" && resourceId.startsWith("unknown-")) {
      blockers.push(`Terraform material change ${index} has no stable resource address`);
    }
    return {
      resourceId,
      action,
      material: action !== "no-op",
      details: `Terraform actions: ${signature || "missing"}`,
    };
  });
  const materialIds = changes.filter(({ material }) => material).map(({ resourceId }) => resourceId);
  for (const duplicate of materialIds.filter((id, index) => materialIds.indexOf(id) !== index)) {
    blockers.push(`Terraform plan contains duplicate material resource address '${duplicate}'`);
  }
  if (array(root.deferred_changes).length > 0) {
    blockers.push("Terraform plan contains deferred changes that cannot be evaluated safely");
  }
  if (root.errored === true) {
    blockers.push("Terraform reported an errored plan");
  }
  const priorState = object(root.prior_state);
  const stateValues = object(priorState?.values);
  const lineage = text(priorState?.lineage) ?? text(stateValues?.lineage);
  const serialValue = priorState?.serial ?? stateValues?.serial;
  const serial =
    typeof serialValue === "number" && Number.isInteger(serialValue) && serialValue >= 0 ? serialValue : undefined;
  return {
    changes,
    blockers,
    ...(lineage === undefined ? {} : { stateLineage: lineage }),
    ...(serial === undefined ? {} : { stateSerial: serial }),
  };
}

export interface AzdOwnedResource {
  readonly logicalId: string;
  readonly resourceId: string;
  readonly type: string;
  readonly location: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface AzdOwnedGroups {
  /** Resource groups carrying the azd-env-name tag with exactly the environment name. */
  readonly taggedGroups: readonly string[];
}

export const AZD_ENV_TAG = "azd-env-name";

function azureReadArray(source: string, stdout: string): readonly unknown[] {
  const value = parseJsonProcessOutput("azure-read", stdout);
  if (!Array.isArray(value)) throw new IacOutputParseError("azure-read", `${source} output must be a JSON array`);
  return value;
}

/** Resource groups tagged `azd-env-name` with the environment name, as azd itself finds an environment's groups. */
export function normalizeAzdTaggedGroups(stdout: string, environmentName: string): AzdOwnedGroups {
  const names = new Set<string>();
  for (const [index, entry] of azureReadArray("Azure group list", stdout).entries()) {
    const group = object(entry);
    const name = text(group?.name);
    if (group === undefined || name === undefined)
      throw new IacOutputParseError("azure-read", `Azure group list entry ${index} is malformed`);
    if (object(group.tags)?.[AZD_ENV_TAG] === environmentName) names.add(name);
  }
  return { taggedGroups: [...names].sort((left, right) => left.localeCompare(right)) };
}

/** Every resource Azure lists in the approved resource group, each verified to live inside that group. */
export function normalizeAzdGroupResources(stdout: string, groupScope: string): readonly AzdOwnedResource[] {
  const prefix = `${groupScope.toLowerCase()}/`;
  const seen = new Set<string>();
  const resources = azureReadArray("Azure resource list", stdout).map((entry, index) => {
    const resource = object(entry);
    const resourceId = text(resource?.id);
    const type = text(resource?.type);
    if (resource === undefined || resourceId === undefined || type === undefined)
      throw new IacOutputParseError("azure-read", `Azure resource list entry ${index} is malformed`);
    if (!resourceId.toLowerCase().startsWith(prefix) || seen.has(resourceId.toLowerCase()))
      throw new IacOutputParseError(
        "azure-read",
        `Azure resource '${resourceId}' is outside the approved resource group`,
      );
    seen.add(resourceId.toLowerCase());
    return {
      logicalId: text(resource.name) ?? resourceId,
      resourceId,
      type,
      location: text(resource.location) ?? "global",
      properties: {},
    };
  });
  return resources.sort((left, right) => left.resourceId.toLowerCase().localeCompare(right.resourceId.toLowerCase()));
}
