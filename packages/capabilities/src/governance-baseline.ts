import { GOVERNANCE_MAX_AGE_MS, type GovernanceConstraintsV1 } from "@apexops/contracts";
import { createHash } from "node:crypto";

export type GovernanceBaselineErrorCode =
  "invalid-input" | "invalid-options" | "incomplete" | "stale" | "target-mismatch";

export class GovernanceBaselineError extends Error {
  constructor(readonly code: GovernanceBaselineErrorCode) {
    super(`Governance baseline rejected: ${code}`);
    this.name = "GovernanceBaselineError";
  }
}

export interface GovernanceBaselineImportOptions {
  readonly subscriptionId: string;
  readonly now: string;
}

export type GovernanceBaselineValidator = (input: unknown) => boolean;
export type GovernanceBaselineRoot =
  | { readonly kind: "management-group"; readonly managementGroupId: string }
  | { readonly kind: "subscription"; readonly subscriptionId: string };

export type GovernanceBaselineJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly GovernanceBaselineJsonValue[]
  | { readonly [key: string]: GovernanceBaselineJsonValue };

export interface GovernanceBaselineFinding {
  readonly policyId: string;
  readonly assignmentId: string;
  readonly policyDefinitionReferenceId?: string;
  readonly requiredValue?: GovernanceBaselineJsonValue;
  readonly effectiveParameters?: { readonly [key: string]: GovernanceBaselineJsonValue };
  readonly displayName: string;
  readonly scope: string;
  readonly effect: "deny" | "audit" | "auditIfNotExists" | "append" | "modify" | "deployIfNotExists" | "disabled";
  readonly enforcementMode?: "Default" | "DoNotEnforce";
  readonly classification: "blocker" | "auto-remediate" | "informational";
  readonly resourceTypes: readonly string[];
  readonly mappingStatus: "unmapped";
  readonly exemption: null | {
    readonly category: "Waiver" | "Mitigated";
    readonly policyDefinitionReferenceIds: readonly string[];
    readonly verificationStatus: "unverified";
  };
}

export interface GovernanceBaselineSelection {
  readonly snapshot: {
    readonly schemaVersion: "governance-baseline-selection-v1";
    readonly subscriptionId: string;
    readonly contentHash: string;
    readonly provenance: {
      readonly root: GovernanceBaselineRoot;
      readonly source: "github-actions-baseline";
      readonly discoveryStatus: "COMPLETE";
      readonly managementGroups: readonly string[];
      readonly completenessSignature: string;
      readonly signatureStatus: "unverified";
    };
    readonly findings: readonly GovernanceBaselineFinding[];
    readonly tagsRequired: readonly {
      readonly name: string;
      readonly allowedValues?: readonly string[];
      readonly default?: string;
    }[];
    readonly allowedLocations: readonly string[];
    readonly reconciliationRequired: true;
  };
  readonly constraints: Pick<
    GovernanceConstraintsV1,
    "schemaVersion" | "targetScope" | "discoveredAt" | "expiresAt" | "summary"
  >;
}

const SUBSCRIPTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_INPUT_BYTES = 20_000_000;

function fail(code: GovernanceBaselineErrorCode = "invalid-input"): never {
  throw new GovernanceBaselineError(code);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) fail();
  return value;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail();
  return value;
}

function strings(value: unknown): string[] {
  return [...new Set(array(value).map(text))].sort();
}

function subscription(value: unknown): string {
  const result = text(value);
  if (!SUBSCRIPTION_ID.test(result)) fail("target-mismatch");
  return result.toLowerCase();
}

function boundedJson(value: unknown): GovernanceBaselineJsonValue {
  let nodes = 0;
  const pending = [{ value, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (++nodes > 4096 || current.depth > 16) fail();
    if (typeof current.value === "number" && !Number.isFinite(current.value)) fail();
    if (current.value !== null && typeof current.value === "object") {
      for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 });
    } else if (current.value !== null && !["string", "number", "boolean"].includes(typeof current.value)) fail();
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 65_536) fail();
  return value as GovernanceBaselineJsonValue;
}

function timestamp(value: unknown): number {
  const result = text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(result)
  )
    fail();
  const parsed = Date.parse(result);
  const date = result.slice(0, 10);
  if (!Number.isFinite(parsed) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) fail();
  return parsed;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonInput(input: unknown): unknown {
  try {
    if (input instanceof Uint8Array && input.byteLength > MAX_INPUT_BYTES) fail();
    const encoded =
      input instanceof Uint8Array
        ? new TextDecoder("utf-8", { fatal: true }).decode(input)
        : typeof input === "string"
          ? input
          : JSON.stringify(input, (_key, value: unknown) => {
              if (typeof value === "number" && !Number.isFinite(value)) fail();
              return value;
            });
    if (typeof encoded !== "string" || Buffer.byteLength(encoded) > MAX_INPUT_BYTES) fail();
    const parsed: unknown = JSON.parse(encoded);
    const pending = [{ value: parsed, depth: 0 }];
    while (pending.length > 0) {
      const { value, depth } = pending.pop()!;
      if (depth > 64) fail();
      if (value !== null && typeof value === "object") {
        for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
      }
    }
    return parsed;
  } catch {
    return fail();
  }
}

function scope(value: unknown, subscriptionId: string): string {
  const result = text(value);
  const normalized = result.toLowerCase();
  if (
    !/^\/providers\/microsoft\.management\/managementgroups\/[^/]+$/u.test(normalized) &&
    normalized !== `/subscriptions/${subscriptionId}` &&
    !normalized.startsWith(`/subscriptions/${subscriptionId}/`)
  )
    fail("target-mismatch");
  return result;
}

function enforcementMode(source: Record<string, unknown>): GovernanceBaselineFinding["enforcementMode"] {
  if (!Object.hasOwn(source, "enforcementMode")) return undefined;
  const mode = source.enforcementMode;
  if (mode !== "Default" && mode !== "DoNotEnforce") fail();
  return mode;
}

function finding(value: unknown, subscriptionId: string): GovernanceBaselineFinding {
  const source = record(value);
  const mode = enforcementMode(source);
  const effect = text(source.effect) as GovernanceBaselineFinding["effect"];
  if (!["deny", "audit", "auditIfNotExists", "append", "modify", "deployIfNotExists", "disabled"].includes(effect))
    fail();
  const classification = text(source.classification) as GovernanceBaselineFinding["classification"];
  if (!["blocker", "auto-remediate", "informational"].includes(classification)) fail();
  let exemption: GovernanceBaselineFinding["exemption"] = null;
  if (source.exemption !== null) {
    const reported = record(source.exemption);
    const category = text(reported.category);
    if (category !== "Waiver" && category !== "Mitigated") fail();
    exemption = {
      category,
      policyDefinitionReferenceIds:
        reported.policyDefinitionReferenceIds === null ? [] : strings(reported.policyDefinitionReferenceIds),
      verificationStatus: "unverified",
    };
  }
  const findingScope = scope(source.scope, subscriptionId);
  const assignmentId = text(source.assignment_id);
  if (
    !assignmentId
      .toLowerCase()
      .startsWith(`${findingScope.toLowerCase()}/providers/microsoft.authorization/policyassignments/`)
  )
    fail("target-mismatch");
  return {
    policyId: text(source.policy_id),
    assignmentId,
    ...(source.policyDefinitionReferenceId === undefined
      ? {}
      : { policyDefinitionReferenceId: text(source.policyDefinitionReferenceId) }),
    ...(source.required_value === undefined ? {} : { requiredValue: boundedJson(source.required_value) }),
    ...(source.assignment_parameters === undefined
      ? {}
      : {
          effectiveParameters: boundedJson(record(source.assignment_parameters)) as {
            readonly [key: string]: GovernanceBaselineJsonValue;
          },
        }),
    displayName: text(source.display_name),
    scope: findingScope,
    effect,
    ...(mode === undefined ? {} : { enforcementMode: mode }),
    classification,
    resourceTypes: strings(source.resource_types),
    mappingStatus: "unmapped",
    exemption,
  };
}

function selectEntry(
  value: unknown,
  subscriptionId: string,
  root: GovernanceBaselineRoot,
  now: number,
  requireFresh: boolean,
): GovernanceBaselineSelection {
  const entry = record(value);
  if (entry.schema_version !== "governance-constraints-v1" || entry.source !== "github-actions-baseline") fail();
  const metadata = record(entry.discovery_metadata);
  if (
    entry.discovery_status !== "COMPLETE" ||
    metadata.discovery_status !== "COMPLETE" ||
    "error" in entry ||
    "errors" in entry ||
    "error" in metadata ||
    "errors" in metadata
  )
    fail("incomplete");
  const metadataScope = record(metadata.scope);
  if (
    subscription(entry.subscription_id) !== subscriptionId ||
    subscription(metadataScope.subscription_id) !== subscriptionId
  )
    fail("target-mismatch");
  const managementGroups = strings(metadataScope.management_groups);
  const discoveredAt = timestamp(entry.discovered_at);
  if (timestamp(metadata.discovered_at) !== discoveredAt) fail("incomplete");
  const ttlDays = count(metadata.ttl_days);
  if (ttlDays < 1 || ttlDays > 90) fail();
  const expiresAt = discoveredAt + GOVERNANCE_MAX_AGE_MS;
  if (now < discoveredAt || (requireFresh && now >= expiresAt)) fail("stale");
  const signature = metadata.completeness_signature;
  if (typeof signature !== "string" || (signature !== "" && !/^sha256:[0-9a-f]{64}$/u.test(signature))) fail();
  const apiVersions = record(metadata.api_versions);
  const pageCounts = record(metadata.page_counts);
  for (const endpoint of ["policyAssignments", "policyDefinitions", "policyExemptions"]) {
    text(apiVersions[endpoint]);
    count(pageCounts[endpoint]);
  }
  const rawFindings = array(entry.findings);
  if (canonical(array(entry.policies)) !== canonical(rawFindings)) fail("incomplete");
  const findings = rawFindings.map((item) => finding(item, subscriptionId));
  const findingIdentities = findings.map((item) =>
    canonical([item.assignmentId.toLowerCase(), item.policyId.toLowerCase(), item.policyDefinitionReferenceId ?? null]),
  );
  if (new Set(findingIdentities).size !== findings.length) fail("incomplete");
  const assignmentModes = new Map<string, GovernanceBaselineFinding["enforcementMode"]>();
  for (const item of findings) {
    if (item.enforcementMode === undefined) continue;
    const mode = assignmentModes.get(item.assignmentId.toLowerCase());
    if (mode !== undefined && mode !== item.enforcementMode) fail("incomplete");
    assignmentModes.set(item.assignmentId.toLowerCase(), item.enforcementMode);
  }
  findings.sort((left, right) =>
    canonical(left) < canonical(right) ? -1 : canonical(left) > canonical(right) ? 1 : 0,
  );
  for (const item of findings) {
    const inherited = /\/managementgroups\/([^/]+)$/iu.exec(item.scope)?.[1];
    if (inherited && !managementGroups.some((group) => group.toLowerCase() === inherited.toLowerCase()))
      fail("target-mismatch");
  }
  const inventory = array(entry.assignment_inventory).map((item) => {
    const assignment = record(item);
    enforcementMode(assignment);
    const assignmentScope = scope(assignment.scope, subscriptionId);
    const inherited = /\/managementgroups\/([^/]+)$/iu.exec(assignmentScope)?.[1];
    if (inherited && !managementGroups.some((group) => group.toLowerCase() === inherited.toLowerCase()))
      fail("target-mismatch");
    text(assignment.displayName);
    text(assignment.policyDefinitionId);
    const expectedType = assignmentScope.toLowerCase().startsWith("/providers/") ? "management-group" : "subscription";
    if (assignment.assignmentType !== expectedType) fail("incomplete");
    return expectedType;
  });
  const summary = record(entry.discovery_summary);
  for (const key of [
    "assignment_total",
    "assignment_kept",
    "defender_auto_filtered",
    "subscription_scope_count",
    "management_group_inherited_count",
    "blocker_count",
    "auto_remediate_count",
    "informational_count",
    "audit_count",
    "disabled_count",
    "exempted_count",
  ])
    count(summary[key]);
  const notScopeExcluded = summary.not_scope_excluded === undefined ? 0 : count(summary.not_scope_excluded);
  const findingAssignments = new Set(findings.map((item) => item.assignmentId.toLowerCase())).size;
  const classifiedMembers = findings.length + Number(summary.audit_count) + Number(summary.disabled_count);
  if (
    findingAssignments > inventory.length ||
    findingAssignments + Number(summary.audit_count) + Number(summary.disabled_count) < inventory.length ||
    (inventory.length === 0 && classifiedMembers !== 0)
  )
    fail("incomplete");
  if (summary.classification_coverage !== undefined) {
    const coverage = record(summary.classification_coverage);
    if (
      count(coverage.assignment_count) !== inventory.length ||
      count(coverage.member_count) !== classifiedMembers ||
      count(coverage.finding_count) !== findings.length ||
      count(coverage.audit_count) !== summary.audit_count ||
      count(coverage.disabled_count) !== summary.disabled_count ||
      count(coverage.unclassified_count) !== 0
    )
      fail("incomplete");
  }
  if (
    summary.assignment_kept !== inventory.length ||
    summary.assignment_total !==
      Number(summary.assignment_kept) + Number(summary.defender_auto_filtered) + notScopeExcluded ||
    pageCounts.policyAssignments !== summary.assignment_total ||
    summary.subscription_scope_count !== inventory.filter((kind) => kind === "subscription").length ||
    summary.management_group_inherited_count !== inventory.filter((kind) => kind === "management-group").length ||
    summary.blocker_count !== findings.filter((item) => item.classification === "blocker").length ||
    summary.auto_remediate_count !== findings.filter((item) => item.classification === "auto-remediate").length ||
    summary.informational_count !== findings.filter((item) => item.classification === "informational").length ||
    summary.exempted_count !== findings.filter((item) => item.exemption !== null).length ||
    (inventory.length === 0 && findings.length > 0)
  )
    fail("incomplete");
  const allowedLocations = strings(entry.allowed_locations);
  if (allowedLocations.length > 256 || array(entry.tags_required).length > 256) fail();
  const tagsRequired = array(entry.tags_required)
    .map((tag) => {
      const reported = record(tag);
      const allowedValues = reported.allowed_values === undefined ? undefined : strings(reported.allowed_values);
      if (allowedValues && allowedValues.length > 256) fail();
      return {
        name: text(reported.name),
        ...(allowedValues === undefined ? {} : { allowedValues }),
        ...(reported.default === undefined ? {} : { default: text(reported.default) }),
      };
    })
    .sort((left, right) => (canonical(left) < canonical(right) ? -1 : canonical(left) > canonical(right) ? 1 : 0));
  return {
    snapshot: {
      schemaVersion: "governance-baseline-selection-v1",
      subscriptionId,
      contentHash: createHash("sha256")
        .update(
          canonical({
            root,
            entry: Object.fromEntries(
              Object.entries(entry)
                .filter(([key]) => key !== "discovered_at" && key !== "ttl_days")
                .map(([key, value]) => [
                  key,
                  key === "discovery_metadata"
                    ? Object.fromEntries(
                        Object.entries(metadata).filter(([field]) => field !== "discovered_at" && field !== "ttl_days"),
                      )
                    : value,
                ]),
            ),
          }),
        )
        .digest("hex"),
      provenance: {
        root,
        source: "github-actions-baseline",
        discoveryStatus: "COMPLETE",
        managementGroups,
        completenessSignature: signature,
        signatureStatus: "unverified",
      },
      findings,
      tagsRequired,
      allowedLocations,
      reconciliationRequired: true,
    },
    constraints: {
      schemaVersion: "1.0.0",
      targetScope: `/subscriptions/${subscriptionId}`,
      discoveredAt: new Date(discoveredAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      summary: {
        assignmentCount: count(summary.assignment_total),
        denyCount: findings.filter((item) => item.effect === "deny").length,
        modifyCount: findings.filter((item) => item.effect === "modify").length,
        auditCount: count(summary.audit_count),
        exemptionCount: count(pageCounts.policyExemptions),
      },
    },
  };
}

function validateGovernanceBaseline(
  input: unknown,
  options: GovernanceBaselineImportOptions,
  validateBaseline: GovernanceBaselineValidator,
  requireFresh: boolean,
): GovernanceBaselineSelection {
  let subscriptionId: string;
  let now: number;
  try {
    subscriptionId = subscription(options.subscriptionId);
    now = timestamp(options.now);
    if (typeof validateBaseline !== "function") fail();
  } catch {
    return fail("invalid-options");
  }
  const baseline = record(jsonInput(input));
  try {
    if (validateBaseline(baseline) !== true) fail();
  } catch {
    return fail();
  }
  if (baseline.schema_version !== "governance-baseline-v1") fail();
  if (baseline.coverage_status !== "COMPLETE" || array(baseline.subscriptions_skipped).length !== 0) fail("incomplete");
  const hasManagementGroup = Object.hasOwn(baseline, "management_group_id");
  if (hasManagementGroup === Object.hasOwn(baseline, "subscription_id")) fail();
  const root: GovernanceBaselineRoot = hasManagementGroup
    ? { kind: "management-group", managementGroupId: text(baseline.management_group_id) }
    : { kind: "subscription", subscriptionId: subscription(baseline.subscription_id) };
  if (root.kind === "subscription" && root.subscriptionId !== subscriptionId) fail("target-mismatch");
  const entries = Object.entries(record(baseline.subscriptions));
  const excluded = array(baseline.subscriptions_excluded).map((item) => {
    const exclusion = record(item);
    if (exclusion.reason !== "disabled" && exclusion.reason !== "AAD_quota") fail("incomplete");
    return subscription(exclusion.subscription_id);
  });
  const ids = entries.map(([key]) => subscription(key));
  if (new Set([...ids, ...excluded]).size !== ids.length + excluded.length || !ids.includes(subscriptionId))
    fail("target-mismatch");
  if (root.kind === "subscription" && (entries.length !== 1 || excluded.length !== 0)) fail("target-mismatch");
  const summary = record(baseline.summary);
  if (
    count(baseline.subscriptions_processed) !== entries.length ||
    count(baseline.subscriptions_discovered) !== entries.length + excluded.length ||
    count(summary.subscriptions_complete) !== entries.length
  )
    fail("incomplete");
  let selected: GovernanceBaselineSelection | undefined;
  let totalFindings = 0;
  let totalBlockers = 0;
  let totalAutoRemediate = 0;
  for (const [key, entry] of entries) {
    const currentId = subscription(key);
    const result = selectEntry(entry, currentId, root, now, requireFresh);
    totalFindings += result.snapshot.findings.length;
    totalBlockers += result.snapshot.findings.filter((item) => item.classification === "blocker").length;
    totalAutoRemediate += result.snapshot.findings.filter((item) => item.classification === "auto-remediate").length;
    if (currentId === subscriptionId) selected = result;
  }
  if (
    count(summary.total_findings) !== totalFindings ||
    count(summary.total_blockers) !== totalBlockers ||
    count(summary.total_auto_remediate) !== totalAutoRemediate
  )
    fail("incomplete");
  return selected ?? fail("target-mismatch");
}

export function importGovernanceBaseline(
  input: unknown,
  options: GovernanceBaselineImportOptions,
  validateBaseline: GovernanceBaselineValidator,
): GovernanceBaselineSelection {
  return validateGovernanceBaseline(input, options, validateBaseline, true);
}

export function inspectGovernanceBaseline(
  input: unknown,
  options: GovernanceBaselineImportOptions,
  validateBaseline: GovernanceBaselineValidator,
): { observedAt: string; refreshRequired: boolean } {
  const selection = validateGovernanceBaseline(input, options, validateBaseline, false);
  return {
    observedAt: selection.constraints.discoveredAt,
    refreshRequired: Date.parse(options.now) >= Date.parse(selection.constraints.expiresAt),
  };
}
