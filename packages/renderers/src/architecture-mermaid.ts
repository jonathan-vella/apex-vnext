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
    .replaceAll("#", "#35;")
    .replaceAll("&", "#amp;")
    .replaceAll('"', "#quot;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll("`", "#96;")
    .trim();
}

/** Single-line plain text for Mermaid accessibility metadata, which does not take entity codes. */
function plain(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f\s]+/gu, " ")
    .replaceAll("{", "(")
    .replaceAll("}", ")")
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
  const actors = [...(architecture.actors ?? [])].sort((left, right) => compare(left.id, right.id));
  const used = new Set<string>(["legend", "legend_key", "lane_actors"]);
  const nodeIds = new Map<string, string>();
  const allocateId = (prefix: string, rawId: string): string => {
    const base = `${prefix}_${rawId.replace(/[^A-Za-z0-9_]/gu, "_")}`;
    let candidate = base;
    for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${base}_${suffix}`;
    used.add(candidate);
    return candidate;
  };
  for (const { id } of components) {
    nodeIds.set(id, allocateId("n", id));
  }
  const actorIds = new Map<string, string>();
  for (const { id } of actors) {
    actorIds.set(id, allocateId("actor", id));
  }
  const flowLabels = new Map<string, string>();
  for (const flow of architecture.flows ?? []) {
    if (flow.label.trim() !== "") flowLabels.set(`${flow.from}->${flow.to}`, flow.label);
  }
  for (const component of components) {
    for (const [targetId, edgeText] of Object.entries(component.edgeLabels ?? {})) {
      if (edgeText.trim() !== "" && !flowLabels.has(`${component.id}->${targetId}`)) {
        flowLabels.set(`${component.id}->${targetId}`, edgeText);
      }
    }
  }
  const lines: string[] = [
    `%% ${label(architecture.title)}`,
    "flowchart TB",
    `  accTitle: ${plain(architecture.title)}`,
    `  accDescr: ${plain(`Architecture diagram with ${components.length} components grouped by Azure resource family. ${architecture.summary}`)}`,
    "  classDef actor_node fill:#f3f2f1,stroke:#323130,color:#172033,stroke-width:1.5px",
    "  classDef lane_actors fill:#faf9f8,stroke:#605e5c,color:#323130,stroke-width:1px",
    "  classDef subnet_box fill:#ffffff,stroke:#605e5c,color:#323130,stroke-width:1px,stroke-dasharray: 4 3",
    "  classDef legend_box fill:#faf9f8,stroke:#8a8886,color:#323130,stroke-width:1px",
  ];
  for (const tier of TIERS) {
    lines.push(
      `  classDef tier_${tier.id} fill:${tier.fill},stroke:${tier.stroke},color:#172033,stroke-width:1.5px`,
      `  classDef lane_${tier.id} fill:${tier.fill},stroke:${tier.stroke},color:${tier.stroke},stroke-width:1px`,
    );
  }
  if (actors.length > 0) {
    lines.push(`  subgraph lane_actors["Actors #amp; callers"]`, "    direction LR");
    for (const actor of actors) {
      const [first = "", ...rest] = wrap(actor.label, 26).map(label);
      const text = [`👤 <b>${first}</b>`, ...rest.map((line) => `<b>${line}</b>`), `<i>${label(actor.id)}</i>`].join(
        "<br/>",
      );
      lines.push(`    ${actorIds.get(actor.id)!}(["${text}"])`);
    }
    lines.push("  end");
  }
  const members = new Map<TierId, string[]>();
  for (const component of components) {
    const tierId = architectureTierOf(component.resourceTypes);
    const list = members.get(tierId) ?? [];
    list.push(nodeIds.get(component.id)!);
    members.set(tierId, list);
  }
  const tierById = new Map<TierId, Tier>(TIERS.map((tier) => [tier.id, tier]));
  const subnetGroups = new Map<string, typeof components>();
  for (const component of components) {
    const subnet = component.subnet?.trim();
    if (!subnet) continue;
    const list = subnetGroups.get(subnet) ?? [];
    list.push(component);
    subnetGroups.set(subnet, list);
  }
  const crossTierSubnets = new Set<string>();
  for (const [subnetName, group] of subnetGroups.entries()) {
    const tiersInSubnet = new Set(group.map(({ resourceTypes }) => architectureTierOf(resourceTypes)));
    if (tiersInSubnet.size > 1) crossTierSubnets.add(subnetName);
  }
  const subnetIds: string[] = [];
  for (const tier of TIERS) {
    const inTier = components.filter(
      ({ resourceTypes, subnet }) =>
        architectureTierOf(resourceTypes) === tier.id && !crossTierSubnets.has(subnet?.trim() ?? ""),
    );
    if (inTier.length === 0) continue;
    lines.push(`  subgraph lane_${tier.id}["${label(tier.title)}"]`, "    direction LR");
    const bySubnet = new Map<string, typeof inTier>();
    const ungrouped: typeof inTier = [];
    for (const component of inTier) {
      const subnet = component.subnet?.trim();
      if (subnet) {
        const list = bySubnet.get(subnet) ?? [];
        list.push(component);
        bySubnet.set(subnet, list);
      } else {
        ungrouped.push(component);
      }
    }
    for (const [subnetName, group] of [...bySubnet.entries()].sort(([a], [b]) => compare(a, b))) {
      const subnetNodeId = allocateId(`subnet_${tier.id}`, subnetName);
      subnetIds.push(subnetNodeId);
      lines.push(`    subgraph ${subnetNodeId}["Boundary: ${label(subnetName)}"]`, "      direction LR");
      for (const component of group) {
        lines.push(
          `      ${nodeIds.get(component.id)!}${shape(tier.id, nodeText(tier, component.service, component.id))}`,
        );
      }
      lines.push("    end");
    }
    for (const component of ungrouped) {
      lines.push(`    ${nodeIds.get(component.id)!}${shape(tier.id, nodeText(tier, component.service, component.id))}`);
    }
    lines.push("  end");
  }
  for (const subnetName of [...crossTierSubnets].sort(compare)) {
    const group = subnetGroups.get(subnetName)!;
    const subnetNodeId = allocateId("subnet_shared", subnetName);
    subnetIds.push(subnetNodeId);
    lines.push(`  subgraph ${subnetNodeId}["Boundary: ${label(subnetName)}"]`, "    direction LR");
    for (const component of group) {
      const tierId = architectureTierOf(component.resourceTypes);
      const tier = tierById.get(tierId)!;
      lines.push(`    ${nodeIds.get(component.id)!}${shape(tierId, nodeText(tier, component.service, component.id))}`);
    }
    lines.push("  end");
  }
  const formatEdge = (fromNode: string, toNode: string, edgeText: string | undefined): string =>
    edgeText !== undefined && edgeText.trim() !== ""
      ? `  ${fromNode} -->|"${label(edgeText)}"| ${toNode}`
      : `  ${fromNode} --> ${toNode}`;
  const resolveEndpoint = (id: string): string | undefined => nodeIds.get(id) ?? actorIds.get(id);
  const edgePairs = new Map<string, readonly [string, string, string]>();
  for (const actor of actors) {
    const fromNode = actorIds.get(actor.id)!;
    for (const targetId of [...new Set(actor.targetIds)].sort(compare)) {
      const toNode = nodeIds.get(targetId);
      if (toNode === undefined || fromNode === toNode) continue;
      edgePairs.set(`${fromNode}->${toNode}`, [fromNode, toNode, `${actor.id}->${targetId}`]);
    }
  }
  for (const component of components) {
    const fromNode = nodeIds.get(component.id)!;
    for (const dependency of [...new Set(component.dependsOn)].sort(compare)) {
      const toNode = nodeIds.get(dependency);
      if (toNode === undefined || fromNode === toNode) continue;
      edgePairs.set(`${fromNode}->${toNode}`, [fromNode, toNode, `${component.id}->${dependency}`]);
    }
  }
  for (const flow of architecture.flows ?? []) {
    const fromNode = resolveEndpoint(flow.from);
    const toNode = nodeIds.get(flow.to);
    if (fromNode === undefined || toNode === undefined || fromNode === toNode) continue;
    const key = `${fromNode}->${toNode}`;
    if (!edgePairs.has(key)) edgePairs.set(key, [fromNode, toNode, `${flow.from}->${flow.to}`]);
  }
  const actorLabelFallback = new Map<string, string>();
  for (const actor of actors) {
    if (actor.edgeLabel !== undefined && actor.edgeLabel.trim() !== "") {
      for (const targetId of actor.targetIds) actorLabelFallback.set(`${actor.id}->${targetId}`, actor.edgeLabel);
    }
  }
  const allEdges = [...edgePairs.values()]
    .map(([fromNode, toNode, lookupKey]) =>
      formatEdge(fromNode, toNode, flowLabels.get(lookupKey) ?? actorLabelFallback.get(lookupKey)),
    )
    .sort(compare);
  lines.push(...allEdges);
  lines.push(
    `  subgraph legend["Legend"]`,
    "    direction LR",
    `    legend_key["([Ingress / Actor]) • [Compute / Network] • [(Data)] • {{Security}}"]`,
    "  end",
  );
  if (actors.length > 0) {
    lines.push(
      `  class ${actors.map(({ id }) => actorIds.get(id)!).join(",")} actor_node`,
      "  class lane_actors lane_actors",
    );
  }
  for (const tier of TIERS) {
    const ids = members.get(tier.id);
    if (ids === undefined) continue;
    lines.push(`  class ${ids.join(",")} tier_${tier.id}`);
    if (lines.some((line) => line.startsWith(`  subgraph lane_${tier.id}[`))) {
      lines.push(`  class lane_${tier.id} lane_${tier.id}`);
    }
  }
  if (subnetIds.length > 0) lines.push(`  class ${subnetIds.join(",")} subnet_box`);
  lines.push("  class legend,legend_key legend_box");
  if (allEdges.length > 0) lines.push(`  linkStyle default stroke:#6b7f94,stroke-width:1.5px`);
  return `${lines.join("\n")}\n`;
}
