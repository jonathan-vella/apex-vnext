import { Resvg } from "@resvg/resvg-js";
import type { ArchitectureV1, CostEstimateV1 } from "@apexops/contracts";
import { stableJson } from "./markdown.js";

export interface DiagramSource {
  readonly svg: string;
  readonly python: string;
}

interface DiagramRow {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly status?: string;
  readonly value?: number;
  readonly lower?: number;
  readonly upper?: number;
}

interface DiagramSpec {
  readonly kind: "architecture" | "waf" | "cost-breakdown" | "cost-uncertainty";
  readonly title: string;
  readonly rows: readonly DiagramRow[];
  readonly edges?: readonly { readonly from: string; readonly to: string }[];
  readonly notes?: readonly string[];
}

const WIDTH = 960;
const BACKGROUND = "#f8fafc";
const INK = "#172033";
const MUTED = "#526173";
const ACCENT = "#0078d4";
const STATUS_COLORS: Readonly<Record<string, string>> = {
  aligned: "#107c10",
  concern: "#ca5010",
  blocker: "#a4262c",
  "not-applicable": "#69797e",
};
const MAX_DIAGRAM_ROWS = 100;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function xml(value: unknown): string {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function short(value: string, length = 64): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= length ? normalized : `${normalized.slice(0, length - 3)}...`;
}

function document(title: string, height: number, body: string, description: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="title description">`,
    `<title id="title">${xml(title)}</title>`,
    `<desc id="description">${xml(description)}</desc>`,
    `<rect width="${WIDTH}" height="${height}" fill="${BACKGROUND}"/>`,
    `<text x="40" y="48" fill="${INK}" font-family="Arial, sans-serif" font-size="24" font-weight="700">${xml(title)}</text>`,
    body,
    `</svg>`,
  ].join("\n");
}

function pythonSource(spec: DiagramSpec): string {
  const encoded = Buffer.from(stableJson(spec), "utf8").toString("base64");
  return `#!/usr/bin/env python3
"""Editable source for an APEX-generated documentation diagram."""
import base64
import json
import matplotlib.pyplot as plt

SPEC = json.loads(base64.b64decode("${encoded}"))

fig, ax = plt.subplots(figsize=(12, max(4, len(SPEC["rows"]) * 0.7)))
labels = [row["label"] for row in SPEC["rows"]]
values = [row.get("value", 1) for row in SPEC["rows"]]
ax.barh(labels, values, color="#0078d4")
ax.set_title(SPEC["title"])
ax.invert_yaxis()
fig.tight_layout()
fig.savefig(SPEC["kind"] + ".png", dpi=150)
`;
}

function source(spec: DiagramSpec, svg: string): DiagramSource {
  if (spec.rows.length > MAX_DIAGRAM_ROWS) throw new Error(`Diagram exceeds ${MAX_DIAGRAM_ROWS} rows`);
  return { svg, python: pythonSource(spec) };
}

export function renderArchitectureDiagram(architecture: ArchitectureV1): DiagramSource {
  const rows = architecture.components
    .map(({ id, service, purpose }) => ({ id, label: `${id}: ${service}`, detail: purpose }))
    .sort((left, right) => compare(left.id, right.id));
  const edges = architecture.components
    .flatMap(({ id, dependsOn }) => dependsOn.map((dependency) => ({ from: dependency, to: id })))
    .sort((left, right) => compare(`${left.from}\0${left.to}`, `${right.from}\0${right.to}`));
  const columns = Math.min(3, Math.max(1, rows.length));
  const nodeWidth = 250;
  const nodeHeight = 82;
  const columnGap = 42;
  const rowGap = 52;
  const positions = new Map(
    rows.map((row, index) => [
      row.id,
      {
        x: 64 + (index % columns) * (nodeWidth + columnGap),
        y: 88 + Math.floor(index / columns) * (nodeHeight + rowGap),
      },
    ]),
  );
  const height = Math.max(260, 130 + Math.ceil(rows.length / columns) * (nodeHeight + rowGap));
  const edgeSvg = edges
    .map(({ from, to }) => {
      const start = positions.get(from);
      const end = positions.get(to);
      if (start === undefined || end === undefined) return "";
      return `<line x1="${start.x + nodeWidth / 2}" y1="${start.y + nodeHeight / 2}" x2="${end.x + nodeWidth / 2}" y2="${end.y + nodeHeight / 2}" stroke="#8a9bad" stroke-width="2"/>`;
    })
    .join("\n");
  const nodeSvg = rows
    .map((row) => {
      const position = positions.get(row.id)!;
      return `<g><rect x="${position.x}" y="${position.y}" width="${nodeWidth}" height="${nodeHeight}" rx="6" fill="#ffffff" stroke="${ACCENT}" stroke-width="2"/><text x="${position.x + 14}" y="${position.y + 30}" fill="${INK}" font-family="Arial, sans-serif" font-size="15" font-weight="700">${xml(short(row.label, 34))}</text><text x="${position.x + 14}" y="${position.y + 56}" fill="${MUTED}" font-family="Arial, sans-serif" font-size="12">${xml(short(row.detail ?? "", 38))}</text></g>`;
    })
    .join("\n");
  const spec: DiagramSpec = { kind: "architecture", title: architecture.title, rows, edges };
  return source(
    spec,
    document(architecture.title, height, `${edgeSvg}\n${nodeSvg}`, "Accepted architecture components and dependencies"),
  );
}

export function renderWafAssessmentDiagram(architecture: ArchitectureV1): DiagramSource {
  const assessment = architecture.wellArchitectedAssessment;
  if (assessment === undefined) throw new Error("Well-Architected assessment is unavailable");
  const order = new Map([
    ["security", 0],
    ["reliability", 1],
    ["performance-efficiency", 2],
    ["cost-optimization", 3],
    ["operational-excellence", 4],
  ]);
  const rows = assessment.pillars
    .map(({ pillar, status, assessment: detail }) => ({ id: pillar, label: pillar, status, detail }))
    .sort((left, right) => (order.get(left.id) ?? 99) - (order.get(right.id) ?? 99));
  const body = rows
    .map((row, index) => {
      const y = 86 + index * 74;
      const color = STATUS_COLORS[row.status ?? ""] ?? MUTED;
      return `<g><rect x="40" y="${y}" width="880" height="56" rx="6" fill="#ffffff" stroke="#d7e0e8"/><rect x="40" y="${y}" width="12" height="56" rx="6" fill="${color}"/><text x="70" y="${y + 23}" fill="${INK}" font-family="Arial, sans-serif" font-size="15" font-weight="700">${xml(row.label.replaceAll("-", " "))}</text><text x="260" y="${y + 23}" fill="${color}" font-family="Arial, sans-serif" font-size="13" font-weight="700">${xml(row.status)}</text><text x="70" y="${y + 44}" fill="${MUTED}" font-family="Arial, sans-serif" font-size="12">${xml(short(row.detail ?? "", 110))}</text></g>`;
    })
    .join("\n");
  const spec: DiagramSpec = { kind: "waf", title: "Azure Well-Architected Assessment", rows };
  return source(
    spec,
    document(spec.title, 480, body, "Qualitative status for the five Azure Well-Architected pillars"),
  );
}

export function renderCostBreakdownDiagram(cost: CostEstimateV1): DiagramSource {
  const rows = cost.lineItems
    .map(({ id, service, sku, monthlyCost }) => ({ id, label: `${service} / ${sku}`, value: monthlyCost }))
    .sort((left, right) => compare(left.id, right.id));
  const maximum = Math.max(1, ...rows.map(({ value }) => value ?? 0));
  const notes = (cost.unpricedItems ?? []).map(({ service, sku }) => `Unpriced: ${service} / ${sku}`).sort(compare);
  const height = Math.max(260, 120 + rows.length * 52 + notes.length * 20);
  const bars = rows
    .map((row, index) => {
      const y = 88 + index * 52;
      const width = ((row.value ?? 0) / maximum) * 520;
      return `<g><text x="40" y="${y + 16}" fill="${INK}" font-family="Arial, sans-serif" font-size="13">${xml(short(row.label, 42))}</text><rect x="350" y="${y}" width="${width.toFixed(2)}" height="22" fill="${ACCENT}"/><text x="${Math.min(880, 360 + width)}" y="${y + 16}" fill="${INK}" font-family="Arial, sans-serif" font-size="12">${xml(`${(row.value ?? 0).toFixed(2)} ${cost.currency}`)}</text></g>`;
    })
    .join("\n");
  const noteSvg = notes
    .map(
      (note, index) =>
        `<text x="40" y="${112 + rows.length * 52 + index * 20}" fill="#a4262c" font-family="Arial, sans-serif" font-size="12">${xml(note)}</text>`,
    )
    .join("\n");
  const spec: DiagramSpec = { kind: "cost-breakdown", title: "Monthly Cost Breakdown", rows, notes };
  return source(
    spec,
    document(spec.title, height, `${bars}\n${noteSvg}`, "Priced monthly costs; unpriced items are excluded"),
  );
}

export function renderCostUncertaintyDiagram(cost: CostEstimateV1): DiagramSource {
  const rows = cost.lineItems
    .map(({ id, service, sku, monthlyCost, uncertainty }) => ({
      id,
      label: `${service} / ${sku}`,
      value: monthlyCost,
      lower: uncertainty.lowerMonthlyCost,
      upper: uncertainty.upperMonthlyCost,
    }))
    .sort((left, right) => compare(left.id, right.id));
  const maximum = Math.max(1, ...rows.map(({ upper }) => upper));
  const height = Math.max(260, 120 + rows.length * 58);
  const ranges = rows
    .map((row, index) => {
      const y = 96 + index * 58;
      const lower = 350 + (row.lower / maximum) * 500;
      const upper = 350 + (row.upper / maximum) * 500;
      const base = 350 + ((row.value ?? 0) / maximum) * 500;
      return `<g><text x="40" y="${y + 5}" fill="${INK}" font-family="Arial, sans-serif" font-size="13">${xml(short(row.label, 42))}</text><line x1="${lower.toFixed(2)}" y1="${y}" x2="${upper.toFixed(2)}" y2="${y}" stroke="#8a9bad" stroke-width="8" stroke-linecap="round"/><circle cx="${base.toFixed(2)}" cy="${y}" r="7" fill="${ACCENT}"/><text x="350" y="${y + 24}" fill="${MUTED}" font-family="Arial, sans-serif" font-size="11">${xml(`${row.lower.toFixed(2)} / ${(row.value ?? 0).toFixed(2)} / ${row.upper.toFixed(2)} ${cost.currency}`)}</text></g>`;
    })
    .join("\n");
  const spec: DiagramSpec = { kind: "cost-uncertainty", title: "Monthly Cost Uncertainty", rows };
  return source(spec, document(spec.title, height, ranges, "Lower, base, and upper monthly cost by priced line item"));
}

export function rasterizeDiagram(svg: string): Uint8Array {
  return new Resvg(svg).render().asPng();
}
