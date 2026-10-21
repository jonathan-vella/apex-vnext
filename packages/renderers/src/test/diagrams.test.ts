import assert from "node:assert/strict";
import test from "node:test";
import type { ArchitectureV1, CostEstimateV1 } from "@apexops/contracts";
import {
  rasterizeDiagram,
  renderArchitectureMermaid,
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
    {
      id: "data",
      service: "Azure SQL",
      resourceTypes: ["Microsoft.Sql/servers"],
      purpose: "Store data",
      requirementIds: ["REQ-1"],
      dependsOn: [],
    },
    {
      id: "api",
      service: "App Service",
      resourceTypes: ["Microsoft.Web/sites"],
      purpose: "Serve requests",
      requirementIds: ["REQ-1"],
      dependsOn: ["data"],
    },
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

test("architecture Mermaid is deterministic, escaped, grouped by tier and draws dependencies as arrows", () => {
  const first = renderArchitectureMermaid(architecture);
  const reordered = renderArchitectureMermaid({ ...architecture, components: [...architecture.components].reverse() });
  assert.equal(first, reordered);
  assert.match(first, /^%% API #lt;platform#gt;\nflowchart TB\n/u);
  assert.doesNotMatch(first.replace(/^ {2}acc.*$/gmu, ""), /<platform>/u);
  assert.match(first, /subgraph lane_application\["Application #amp; compute"\]/u);
  assert.match(first, /subgraph lane_data\["Data #amp; messaging"\]/u);
  assert.ok(first.indexOf("lane_application[") < first.indexOf("lane_data["));
  assert.match(first, /n_data\[\("🗄️ <b>Azure SQL<\/b><br\/><i>data<\/i>"\)\]/u);
  assert.match(first, /n_api\["⚙️ <b>App Service<\/b><br\/><i>api<\/i>"\]/u);
  assert.match(first, /^ {2}n_api --> n_data$/mu);
  assert.match(first, /^ {2}class n_api tier_application$/mu);
  assert.match(first, /^ {2}accTitle: API <platform>$/mu);
  assert.match(first, /^ {2}accDescr: Architecture diagram with 2 components grouped by Azure resource family\. /mu);
});

test("architecture Mermaid keeps literal entity text distinct from the characters it encodes", () => {
  const component = (id: string, service: string) => ({
    id,
    service,
    resourceTypes: ["Microsoft.Web/sites"],
    purpose: "Purpose",
    requirementIds: ["REQ-1"],
    dependsOn: [],
  });
  const text = renderArchitectureMermaid({
    ...architecture,
    components: [component("a", "#quot;"), component("b", '"'), component("c", "Tier #1")],
  });
  assert.match(text, /<b>#35;quot;<\/b>/u);
  assert.match(text, /<b>#quot;<\/b>/u);
  assert.match(text, /<b>Tier #35;1<\/b>/u);
});

test("architecture Mermaid keeps full labels, unique node ids, and only valid dependency arrows", () => {
  const component = (id: string, service: string, resourceTypes: string[], dependsOn: string[] = []) => ({
    id,
    service,
    resourceTypes,
    purpose: "Purpose",
    requirementIds: ["REQ-1"],
    dependsOn,
  });
  const text = renderArchitectureMermaid({
    ...architecture,
    components: [
      component(
        "front-door",
        'Azure Front Door Premium with "managed" WAF and Private Link origin',
        ["Microsoft.Cdn/profiles"],
        ["missing", "front-door", "app_x", "app-x", "app-x"],
      ),
      component("app-x", "App Service", ["Microsoft.Web/sites"]),
      component("app_x", "Second App", ["Microsoft.Web/sites"]),
      component("mystery", "Unmapped", ["Contoso.Widgets/things"]),
    ],
  });
  assert.match(
    text,
    /\(\["🌐 <b>Azure Front Door Premium<\/b><br\/><b>with #quot;managed#quot; WAF and<\/b><br\/><b>Private Link origin<\/b><br\/><i>front-door<\/i>"\]\)/u,
  );
  assert.doesNotMatch(text, /\.\.\./u);
  assert.match(text, /n_app_x\[/u);
  assert.match(text, /n_app_x_2\[/u);
  assert.match(text, /subgraph lane_other\["Other"\]/u);
  const arrows = text.split("\n").filter((line) => line.includes("-->"));
  assert.deepEqual(arrows, ["  n_front_door --> n_app_x", "  n_front_door --> n_app_x_2"]);
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

test("cost diagram renderers reject NaN, Infinity, and negative cost values", () => {
  const baseItem = cost.lineItems[0]!;
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
    assert.throws(
      () =>
        renderCostBreakdownDiagram({
          ...cost,
          lineItems: [{ ...baseItem, monthlyCost: invalid }],
        }),
      /Invalid cost line item 'api' monthlyCost/u,
    );
    assert.throws(
      () =>
        renderCostUncertaintyDiagram({
          ...cost,
          lineItems: [{ ...baseItem, monthlyCost: invalid }],
        }),
      /Invalid cost line item 'api' monthlyCost/u,
    );
    assert.throws(
      () =>
        renderCostUncertaintyDiagram({
          ...cost,
          lineItems: [
            {
              ...baseItem,
              uncertainty: { ...baseItem.uncertainty, lowerMonthlyCost: invalid },
            },
          ],
        }),
      /Invalid cost line item 'api' lowerMonthlyCost/u,
    );
    assert.throws(
      () =>
        renderCostUncertaintyDiagram({
          ...cost,
          lineItems: [
            {
              ...baseItem,
              uncertainty: { ...baseItem.uncertainty, upperMonthlyCost: invalid },
            },
          ],
        }),
      /Invalid cost line item 'api' upperMonthlyCost/u,
    );
  }
});
