import assert from "node:assert/strict";
import test from "node:test";
import type { ArchitectureV1, CostEstimateV1 } from "@apexops/contracts";
import {
  rasterizeDiagram,
  renderArchitectureDiagram,
  renderCostBreakdownDiagram,
  renderCostUncertaintyDiagram,
  renderWafAssessmentDiagram,
} from "../index.js";

const hash = "a".repeat(64);
const architecture: ArchitectureV1 = {
  schemaVersion: "1.0.0",
  projectId: "sample",
  runId: "run-1",
  title: "API <platform>",
  summary: "Managed API",
  sourceHashes: { requirements: hash },
  components: [
    { id: "data", service: "Azure SQL", purpose: "Store data", requirementIds: ["REQ-1"], dependsOn: [] },
    { id: "api", service: "App Service", purpose: "Serve requests", requirementIds: ["REQ-1"], dependsOn: ["data"] },
  ],
  decisions: [],
  risks: [],
  wellArchitectedAssessment: {
    framework: "azure-well-architected-framework",
    assessmentType: "qualitative",
    pillars: ["security", "reliability", "performance-efficiency", "cost-optimization", "operational-excellence"].map(
      (pillar) => ({
        pillar: pillar as NonNullable<ArchitectureV1["wellArchitectedAssessment"]>["pillars"][number]["pillar"],
        status: "aligned",
        assessment: `${pillar} posture`,
        requirementIds: ["REQ-1"],
        evidenceRefs: [hash],
        recommendations: [],
        tradeoffs: [],
      }),
    ),
  },
};
const cost: CostEstimateV1 = {
  schemaVersion: "1.0.0",
  projectId: "sample",
  runId: "run-1",
  currency: "USD",
  pricingDate: "2026-08-28",
  pricingStatus: "partial",
  lineItems: [
    {
      id: "api",
      service: "App Service",
      sku: "P1v3",
      quantity: 1,
      unitPrice: 100,
      unitsPerMonth: 1,
      monthlyCost: 100,
      source: { provider: "ARM MCP", uri: "https://example.test", retrievedAt: "2026-08-28T00:00:00Z" },
      uncertainty: { lowerMonthlyCost: 90, upperMonthlyCost: 120, confidence: "medium", basis: "Usage" },
    },
  ],
  unpricedItems: [
    {
      id: "data",
      service: "Azure SQL",
      sku: "GP",
      quantity: 1,
      attemptedAt: "2026-08-28T00:00:00Z",
      reason: "No matching meter",
    },
  ],
  totalMonthlyCost: 100,
  assumptions: [],
};

test("diagram renderers are deterministic, escaped, and produce PNG", () => {
  const first = renderArchitectureDiagram(architecture);
  const reordered = renderArchitectureDiagram({ ...architecture, components: [...architecture.components].reverse() });
  assert.equal(first.svg, reordered.svg);
  assert.equal(first.python, reordered.python);
  assert.match(first.svg, /API &lt;platform&gt;/u);
  assert.doesNotMatch(first.svg, /<platform>/u);
  const png = rasterizeDiagram(first.svg);
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("WAF and cost diagrams preserve qualitative and partial pricing semantics", () => {
  const waf = renderWafAssessmentDiagram(architecture);
  const breakdown = renderCostBreakdownDiagram(cost);
  const uncertainty = renderCostUncertaintyDiagram(cost);
  assert.match(waf.svg, /operational excellence/u);
  assert.match(breakdown.svg, /Unpriced: Azure SQL \/ GP/u);
  assert.match(breakdown.svg, /100\.00 USD/u);
  assert.match(uncertainty.svg, /90\.00 \/ 100\.00 \/ 120\.00 USD/u);
  for (const output of [waf, breakdown, uncertainty]) {
    assert.match(output.python, /Editable source/u);
    assert.ok(rasterizeDiagram(output.svg).byteLength > 100);
  }
});
