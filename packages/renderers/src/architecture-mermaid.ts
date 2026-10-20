import type { ArchitectureV1 } from "@apexops/contracts";

type TierId = "edge" | "application" | "data" | "network" | "security" | "operations" | "other";

interface Tier {
  readonly id: TierId;
  readonly title: string;
  readonly icon: string;
  readonly fill: string;
  readonly stroke: string;
}

const TIERS: readonly Tier[] = [
  { id: "edge", title: "Edge & ingress", icon: "🌐", fill: "#e8f3fc", stroke: "#0f6cbd" },
  { id: "application", title: "Application & compute", icon: "⚙️", fill: "#e9f6e8", stroke: "#107c10" },
  { id: "data", title: "Data & messaging", icon: "🗄️", fill: "#fdf3e3", stroke: "#b45f06" },
  { id: "network", title: "Network & private access", icon: "🔌", fill: "#efeaf8", stroke: "#6b4ea8" },
  { id: "security", title: "Security & identity", icon: "🔑", fill: "#fbeaea", stroke: "#a4262c" },
  { id: "operations", title: "Monitoring & operations", icon: "📊", fill: "#e6f2f3", stroke: "#0b6a6f" },
  { id: "other", title: "Other", icon: "📦", fill: "#eef0f2", stroke: "#5b6773" },
];

// First matching lowercase ARM resource type prefix wins, so specific edge types precede the generic network rule.
const TIER_RULES: readonly (readonly [string, TierId])[] = [
  ["microsoft.cdn/", "edge"],
  ["microsoft.apimanagement/", "edge"],
  ["microsoft.network/frontdoor", "edge"],
  ["microsoft.network/applicationgateway", "edge"],
  ["microsoft.network/trafficmanagerprofiles", "edge"],
  ["microsoft.network/", "network"],
  ["microsoft.web/", "application"],
  ["microsoft.app/", "application"],
  ["microsoft.containerservice/", "application"],
  ["microsoft.containerinstance/", "application"],
  ["microsoft.containerregistry/", "application"],
  ["microsoft.compute/", "application"],
  ["microsoft.logic/", "application"],
  ["microsoft.sql/", "data"],
  ["microsoft.storage/", "data"],
  ["microsoft.documentdb/", "data"],
  ["microsoft.dbforpostgresql/", "data"],
  ["microsoft.dbformysql/", "data"],
  ["microsoft.cache/", "data"],
  ["microsoft.servicebus/", "data"],
  ["microsoft.eventhub/", "data"],
  ["microsoft.eventgrid/", "data"],
  ["microsoft.search/", "data"],
  ["microsoft.keyvault/", "security"],
  ["microsoft.managedidentity/", "security"],
  ["microsoft.authorization/", "security"],
  ["microsoft.security/", "security"],
  ["microsoft.insights/", "operations"],
  ["microsoft.operationalinsights/", "operations"],
  ["microsoft.monitor/", "operations"],
  ["microsoft.alertsmanagement/", "operations"],
  ["microsoft.dashboard/", "operations"],
];

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Groups a component by the first Azure resource type that matches a known family; unknown types fall into "other". */
export function architectureTierOf(resourceTypes: readonly string[]): TierId {
  for (const type of [...resourceTypes].map((value) => value.toLowerCase()).sort(compare)) {
    const rule = TIER_RULES.find(([prefix]) => type.startsWith(prefix));
    if (rule !== undefined) return rule[1];
  }
  return "other";
}

/** Escapes text for a double-quoted Mermaid label using Mermaid's numeric and named entity codes. */
function label(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replaceAll("&", "#amp;")
    .replaceAll('"', "#quot;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll("`", "#96;")
    .trim();
}

/** Wraps on word boundaries with Mermaid line breaks; never truncates. */
function wrap(value: string, maxChars: number): string[] {
  const words = value.replace(/\s+/gu, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length <= maxChars || current === "") current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

function nodeText(tier: Tier, service: string, id: string): string {
  const [first = "", ...rest] = wrap(service, 26).map(label);
  const lines = [`${tier.icon} <b>${first}</b>`, ...rest.map((line) => `<b>${line}</b>`), `<i>${label(id)}</i>`];
  return lines.join("<br/>");
}

function shape(tier: TierId, text: string): string {
  switch (tier) {
    case "data":
      return `[("${text}")]`;
    case "edge":
      return `(["${text}"])`;
    case "security":
      return `{{"${text}"}}`;
    default:
      return `["${text}"]`;
  }
}

/**
 * Deterministic Mermaid flowchart of an accepted architecture. Components are grouped into subgraphs by Azure resource
 * type family, and each `dependsOn` relation is an arrow from the dependent component to the component it depends on.
 * Mermaid performs the layout, so the diagram stays editable text that renders wherever Mermaid is supported.
 */
export function renderArchitectureMermaid(architecture: ArchitectureV1): string {
  const components = [...architecture.components].sort((left, right) => compare(left.id, right.id));
  const used = new Set<string>();
  const nodeIds = new Map<string, string>();
  for (const { id } of components) {
    const base = `n_${id.replace(/[^A-Za-z0-9_]/gu, "_")}`;
    let candidate = base;
    for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${base}_${suffix}`;
    used.add(candidate);
    nodeIds.set(id, candidate);
  }
  const lines: string[] = [`%% ${label(architecture.title)}`, "flowchart TB"];
  for (const tier of TIERS) {
    lines.push(
      `  classDef tier_${tier.id} fill:${tier.fill},stroke:${tier.stroke},color:#172033,stroke-width:1.5px`,
      `  classDef lane_${tier.id} fill:${tier.fill},stroke:${tier.stroke},color:${tier.stroke},stroke-width:1px`,
    );
  }
  const members = new Map<TierId, string[]>();
  for (const tier of TIERS) {
    const inTier = components.filter(({ resourceTypes }) => architectureTierOf(resourceTypes) === tier.id);
    if (inTier.length === 0) continue;
    lines.push(`  subgraph lane_${tier.id}["${label(tier.title)}"]`, "    direction LR");
    for (const component of inTier) {
      lines.push(`    ${nodeIds.get(component.id)!}${shape(tier.id, nodeText(tier, component.service, component.id))}`);
    }
    lines.push("  end");
    members.set(
      tier.id,
      inTier.map(({ id }) => nodeIds.get(id)!),
    );
  }
  const edges = components
    .flatMap((component) =>
      [...new Set(component.dependsOn)]
        .filter((dependency) => nodeIds.has(dependency) && dependency !== component.id)
        .sort(compare)
        .map((dependency) => `  ${nodeIds.get(component.id)!} --> ${nodeIds.get(dependency)!}`),
    )
    .sort(compare);
  lines.push(...edges);
  for (const tier of TIERS) {
    const ids = members.get(tier.id);
    if (ids === undefined) continue;
    lines.push(`  class ${ids.join(",")} tier_${tier.id}`, `  class lane_${tier.id} lane_${tier.id}`);
  }
  if (edges.length > 0) lines.push(`  linkStyle default stroke:#6b7f94,stroke-width:1.5px`);
  return `${lines.join("\n")}\n`;
}
