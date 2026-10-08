import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateManagedFileHashInventory,
  loadRepositoryModel,
  parseProjectionFrontmatter,
  validateRepositoryModel,
} from "../../scripts/validate-vnext.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const baseline = loadRepositoryModel(root);
const mutate = (change) => {
  const model = structuredClone(baseline);
  change(model);
  return validateRepositoryModel(model);
};
const hasRule = (result, ruleId) => result.findings.some((finding) => finding.ruleId === ruleId);

test("repository model satisfies vNext contracts", () => {
  const result = validateRepositoryModel(baseline);
  assert.deepEqual(result.findings, []);
  assert.ok(Object.values(generateManagedFileHashInventory(baseline)).every((hash) => /^[a-f0-9]{64}$/.test(hash)));
});

test("generated shared governance source inventory remains exact and canonical", () => {
  const hashes = generateManagedFileHashInventory(baseline);
  for (const source of [
    ".github/workflows/governance-policy-baseline.yml",
    "tools/scripts/collect-governance-baseline.ps1",
    "tools/schemas/governance-baseline.schema.json",
  ]) {
    assert.equal(
      hashes[source],
      createHash("sha256")
        .update(readFileSync(path.join(root, source)))
        .digest("hex"),
    );
    assert.ok(
      hasRule(
        mutate((model) => {
          model.customization.manifest.sharedFiles = model.customization.manifest.sharedFiles.filter(
            (file) => file !== source,
          );
        }),
        "customization.shared-coverage",
      ),
    );
    assert.ok(
      hasRule(
        mutate((model) => {
          model.customization.manifest.managedFiles = model.customization.manifest.managedFiles.filter(
            (file) => file !== source,
          );
        }),
        "customization.coverage",
      ),
    );
  }
  assert.ok(
    hasRule(
      mutate((model) => {
        model.customization.manifest.sharedFiles.push("tools/scripts/unreviewed.ps1");
        model.customization.manifest.managedFiles.push("tools/scripts/unreviewed.ps1");
      }),
      "customization.shared-coverage",
    ),
  );
});

test("projection frontmatter parsing fails closed", () => {
  assert.deepEqual(parseProjectionFrontmatter("body only"), {
    frontmatter: null,
    error: "missing YAML frontmatter",
  });
  assert.deepEqual(parseProjectionFrontmatter("---\ntools: [unterminated\n---\n"), {
    frontmatter: null,
    error: "malformed YAML frontmatter",
  });
  assert.deepEqual(parseProjectionFrontmatter("---\n- invalid\n---\n"), {
    frontmatter: null,
    error: "frontmatter must be a YAML object",
  });
});

test("canonical managed source inventory rejects symlinked ancestors and duplicate maintained copies", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "apex-source-inventory-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const repository = path.join(temporaryRoot, "repo");
  const outside = path.join(temporaryRoot, "outside");
  const source = "tools/scripts/collect-governance-baseline.ps1";
  const model = structuredClone(baseline);
  model.root = repository;
  model.customization.manifest.managedFiles = [source];
  await mkdir(path.join(repository, "tools/scripts"), { recursive: true });
  await mkdir(path.join(outside, "scripts"), { recursive: true });
  await writeFile(path.join(repository, source), "canonical\n");
  await writeFile(path.join(outside, "scripts/collect-governance-baseline.ps1"), "outside\n");
  assert.equal(Object.keys(generateManagedFileHashInventory(model)).length, 1);
  await mkdir(path.join(repository, "customizations/tools/scripts"), { recursive: true });
  await writeFile(path.join(repository, "customizations", source), "duplicate\n");
  assert.throws(() => generateManagedFileHashInventory(model), /Unsafe managed path/u);
  await rm(path.join(repository, "customizations"), { recursive: true });
  await rm(path.join(repository, "tools"), { recursive: true });
  await symlink(outside, path.join(repository, "tools"), "dir");
  assert.throws(() => generateManagedFileHashInventory(model), /Unsafe managed path/u);
});

test("rejects CI lint before the vNext build", () => {
  const result = mutate((model) => {
    model.rootManifest.scripts["validate:_node-ci"] = model.rootManifest.scripts["validate:_node-ci"].replace(
      "npm run build:vnext && ",
      "",
    );
  });
  assert.ok(hasRule(result, "ci.vnext-build-order"));
});

test("rejects cached CI lint over generated imports", () => {
  const result = mutate((model) => {
    model.rootManifest.scripts["lint:js:ci"] = model.rootManifest.scripts["lint:js:ci"].replace("--no-cache ", "");
  });
  assert.ok(hasRule(result, "ci.lint-cache"));
});

test("rejects a divergent CI validation entrypoint", () => {
  const result = mutate((model) => {
    model.ciWorkflow.jobs.ci.steps.find(({ run }) => run === "npm run validate:_node-ci").run = "npm run lint:js:ci";
  });
  assert.ok(hasRule(result, "ci.validation-entrypoint"));
});

test("rejects retired interactive specialists and handoff edges", () => {
  const result = mutate((model) => {
    model.customization.manifest.roles.push({
      id: "requirements",
      source: ".github/agents/apex-requirements.agent.md",
      agent: "APEX Requirements",
      role: "requirements",
      supportedTargets: ["github-copilot"],
      interactionType: "interactive-handoff",
    });
    model.customization.manifest.invocationEdges.push({ from: "APEX", to: "APEX Requirements", type: "handoff" });
  });
  assert.ok(hasRule(result, "customization.single-interactive-agent"));
  assert.ok(hasRule(result, "customization.retired-agent"));
  assert.ok(hasRule(result, "customization.handoff-edge"));
});

test("CLI distinguishes interactive handoffs from supported subagent edges", () => {
  const result = mutate((model) => {
    model.customization.manifest.invocationEdges = model.customization.manifest.invocationEdges.filter(
      ({ from, type }) => from !== "APEX" || type !== "subagent",
    );
  });
  assert.ok(hasRule(result, "customization.cli-delegation"));
});

test("CLI preserves an explicit worker invocation-disable boundary", () => {
  const result = mutate((model) => {
    model.customization.agents.find(({ frontmatter }) => frontmatter.name === "APEX Reviewer").frontmatter[
      "disable-model-invocation"
    ] = true;
  });
  assert.ok(hasRule(result, "customization.cli-authority"));
});

test("keeps native read tools off hidden workers", () => {
  const result = mutate((model) => {
    model.customization.agents
      .find(({ frontmatter }) => frontmatter.name === "APEX Reviewer")
      .frontmatter.tools.push("view");
  });
  assert.ok(hasRule(result, "customization.worker-read-tool"));
  const planner = mutate(() => {});
  assert.ok(!hasRule(planner, "customization.worker-read-tool"));
});

test("rejects unknown managed agent tool names while accepting the central inventory", () => {
  const unknownResult = mutate((model) => {
    model.customization.agents
      .find(({ frontmatter }) => frontmatter.name === "APEX")
      .frontmatter.tools.push("definitely_not_a_tool");
  });
  assert.ok(hasRule(unknownResult, "customization.unknown-tool"));

  const inventoryResult = mutate((model) => {
    const apex = model.customization.agents.find(({ frontmatter }) => frontmatter.name === "APEX");
    apex.frontmatter.tools = [
      ...Object.values(model.customization.toolInventory.interactiveTools),
      ...model.customization.toolInventory.agentReadTools,
      "web_fetch",
      "apex-azure-pricing/get_retail_prices",
    ];
  });
  assert.ok(!hasRule(inventoryResult, "customization.unknown-tool"));
  assert.ok(!hasRule(inventoryResult, "customization.mcp-tool"));

  const retiredServerResult = mutate((model) => {
    model.customization.agents
      .find(({ frontmatter }) => frontmatter.name === "APEX")
      .frontmatter.tools.push("azure-resource-manager-mcp/get_retail_prices");
  });
  assert.ok(hasRule(retiredServerResult, "customization.mcp-tool"));
});

test("rejects ask_user on an autonomous subagent", () => {
  const result = mutate((model) => {
    model.customization.agents
      .find(({ frontmatter }) => frontmatter.name === "APEX Reviewer")
      .frontmatter.tools.push("ask_user");
  });
  assert.ok(hasRule(result, "customization.subagent-questions"));
});

test("rejects web_fetch agents without the global fetch guard", () => {
  const result = mutate((model) => {
    const apex = model.customization.agents.find(({ frontmatter }) => frontmatter.name === "APEX");
    apex.content = apex.content.replace("registry.terraform.io", "registry.example.invalid");
  });
  assert.ok(hasRule(result, "customization.web-fetch-guard"));
});

test("rejects ask_user argument prescriptions in managed guidance and generated projections", () => {
  const managedResult = mutate((model) => {
    model.customization.guidance.push({
      path: ".github/instructions/bad.instructions.md",
      content: "Call `ask_user` with `question` and `choices` parameters.",
    });
  });
  assert.ok(hasRule(managedResult, "customization.ask-user-arguments"));

  const wrappedResult = mutate((model) => {
    model.customization.guidance.push({
      path: ".github/instructions/wrapped-bad.instructions.md",
      content: "Call `ask_user`\nwith `message` and `requestedSchema` arguments.",
    });
  });
  assert.ok(hasRule(wrappedResult, "customization.ask-user-arguments"));

  assert.ok(
    !hasRule(
      mutate(() => {}),
      "customization.ask-user-arguments",
    ),
  );
});

test("rejects worker prompts that rely on caller context or omit taskContext delegation guidance", () => {
  const workerResult = mutate((model) => {
    model.customization.agents.find(({ frontmatter }) => frontmatter.name === "APEX Reviewer").content +=
      "\nSee the coordinator instructions for the review criteria.\n";
  });
  assert.ok(hasRule(workerResult, "customization.worker-context"));

  const unrelatedNegationResult = mutate((model) => {
    model.customization.agents.find(({ frontmatter }) => frontmatter.name === "APEX Reviewer").content +=
      "\nDo not guess; see the coordinator instructions for the review criteria.\n";
  });
  assert.ok(hasRule(unrelatedNegationResult, "customization.worker-context"));

  const parentResult = mutate((model) => {
    const apex = model.customization.agents.find(({ frontmatter }) => frontmatter.name === "APEX");
    apex.content = apex.content.replaceAll("apex/taskContext", "apex/status");
  });
  assert.ok(hasRule(parentResult, "customization.worker-context"));
});

test("rejects retired VS Code agent fields and tools", () => {
  for (const retire of [
    (frontmatter) => frontmatter.tools.push("vscode/askQuestions"),
    (frontmatter) => frontmatter.tools.push("agent"),
    (frontmatter) => (frontmatter.handoffs = []),
    (frontmatter) => (frontmatter.agents = []),
    (frontmatter) => (frontmatter["argument-hint"] = "Describe the workload"),
  ]) {
    const result = mutate((model) => {
      retire(model.customization.agents.find(({ frontmatter }) => frontmatter.name === "APEX").frontmatter);
    });
    assert.ok(hasRule(result, "customization.retired-field"));
  }
});

test("rejects target declarations in shared managed agent sources", () => {
  const result = mutate((model) => {
    model.customization.agents.find(({ frontmatter }) => frontmatter.name === "APEX").frontmatter.target = "vscode";
  });
  assert.ok(hasRule(result, "customization.source-target"));
});

test("rejects a managed role with no supported target", () => {
  const result = mutate((model) => {
    model.customization.manifest.roles[0].supportedTargets = [];
  });
  assert.ok(hasRule(result, "customization.schema"));
});

test("rejects a missing MCP tool", () => {
  const result = mutate((model) => {
    model.mcpTools = model.mcpTools.filter((tool) => tool !== "status");
  });
  assert.ok(hasRule(result, "customization.mcp-tool"));
});

test("rejects plugin MCP launch drift", () => {
  const result = mutate((model) => {
    model.customization.pluginMcp.mcpServers.apex.command = "npx";
    model.customization.pluginMcp.mcpServers.apex.args = ["--no", "apex", "mcp", "serve"];
  });
  assert.ok(hasRule(result, "mcp.plugin-launch"));

  const extraServer = mutate((model) => {
    model.customization.pluginMcp.mcpServers["azure-resource-manager-mcp"] = { type: "streamable-http", url: "x" };
  });
  assert.ok(hasRule(extraServer, "mcp.plugin-launch"));
});

test("rejects ARM MCP launch drift", () => {
  const endpointResult = mutate((model) => {
    model.customization.pluginMcp.mcpServers["apex-azure-pricing"].url = "https://example.invalid";
  });
  assert.ok(hasRule(endpointResult, "mcp.plugin-arm-launch"));

  const toolsetResult = mutate((model) => {
    model.customization.pluginMcp.mcpServers["apex-azure-pricing"].headers["x-mcp-toolset"] = "Pricing";
  });
  assert.ok(hasRule(toolsetResult, "mcp.plugin-arm-launch"));

  const transportResult = mutate((model) => {
    model.customization.pluginMcp.mcpServers["apex-azure-pricing"].type = "http";
  });
  assert.ok(hasRule(transportResult, "mcp.plugin-arm-launch"));
});

test("rejects plugin settings drift", () => {
  const marketplace = mutate((model) => {
    model.customization.pluginSettings.extraKnownMarketplaces["apex-plugins"].source.repo = "someone/else";
  });
  assert.ok(hasRule(marketplace, "customization.plugin-settings"));

  const extra = mutate((model) => {
    model.customization.pluginSettings.model = "gpt-5";
  });
  assert.ok(hasRule(extra, "customization.plugin-settings"));

  const disabled = mutate((model) => {
    model.customization.pluginSettings.enabledPlugins["apex@apex-plugins"] = false;
  });
  assert.ok(hasRule(disabled, "customization.plugin-settings"));
});

test("rejects reintroducing plugin-owned agents, skills or MCP config into the workspace projection", () => {
  for (const path of [".github/agents/apex.agent.md", ".github/skills/apex-next/SKILL.md", ".mcp.json"]) {
    const managed = mutate((model) => {
      model.customization.manifest.managedFiles.push(path);
    });
    assert.ok(hasRule(managed, "customization.plugin-reintroduced"), path);
  }
  const directory = mutate((model) => {
    model.customization.manifest.sharedDirectories.push(".github/skills");
  });
  assert.ok(hasRule(directory, "customization.plugin-reintroduced"));
  const projection = mutate((model) => {
    model.customization.manifest.clientProjections[0].files.push(".mcp.json");
  });
  assert.ok(hasRule(projection, "customization.plugin-reintroduced"));
  const source = mutate((model) => {
    model.customization.retiredWorkspaceMcp = true;
  });
  assert.ok(hasRule(source, "customization.plugin-reintroduced"));
  const coverage = mutate((model) => {
    model.customization.manifest.plugin.files.pop();
  });
  assert.ok(hasRule(coverage, "customization.plugin-coverage"));
});

test("rejects client projection declaration drift", () => {
  const projectionResult = mutate((model) => {
    model.customization.manifest.clientProjections[0].files = [".github/mcp.json"];
  });
  assert.ok(hasRule(projectionResult, "customization.client-projection"));

  for (const id of ["github-copilot-vscode", "both"]) {
    const retiredResult = mutate((model) => {
      model.customization.manifest.clientProjections.push({
        id,
        generatedRoot: `client-projections/${id}`,
        files: [".vscode/mcp.json"],
      });
    });
    assert.ok(hasRule(retiredResult, "customization.schema"));
  }
});

test("rejects an unsafe managed path", () => {
  const result = mutate((model) => {
    model.customization.manifest.managedFiles.push("../package.json");
  });
  assert.ok(hasRule(result, "managed-path.safety"));
});

test("rejects Gate 4 inheritance", () => {
  const result = mutate((model) => {
    model.config["workflow.v1.json"].promotion.gateRules.find(({ gates }) => gates.includes(4)).inheritance = "allowed";
  });
  assert.ok(hasRule(result, "workflow.gate4-inheritance"));
});

test("rejects an internal package cycle", () => {
  const result = mutate((model) => {
    model.packages.contracts.manifest.dependencies["@apexops/kernel"] = "0.1.0";
    model.packages.contracts.tsconfig.references = [{ path: "../kernel" }];
  });
  assert.ok(hasRule(result, "package.cycle"));
});

test("rejects a runtime package version mismatch", () => {
  const result = mutate((model) => {
    model.config["runtime-bundle.v1.json"].components.kernel.version = "9.9.9";
  });
  assert.ok(hasRule(result, "runtime.version"));
});

test("requires the VS Code 1.140 Copilot harness minimum in the toolchain", () => {
  const vscode = (change) =>
    mutate((model) => {
      change(model.config["toolchain.v1.json"]);
    });
  for (const version of ["1.139.0", "1.139.1", "1.140", "01.140.0", "1.140.00", "latest"]) {
    const result = vscode((toolchain) => {
      toolchain.core.vscode.minimumSupportedVersion = version;
      toolchain.compatibilitySet.minimumVscode = version;
    });
    assert.ok(hasRule(result, "toolchain.vscode-minimum"), version);
  }
  assert.ok(
    hasRule(
      vscode((toolchain) => {
        toolchain.compatibilitySet.minimumVscode = "1.139.0";
      }),
      "toolchain.vscode-minimum",
    ),
  );
  assert.ok(
    hasRule(
      vscode((toolchain) => {
        toolchain.core.vscode.installedVersion = "1.139.1";
      }),
      "toolchain.vscode-minimum",
    ),
  );
  const accepted = vscode((toolchain) => {
    for (const field of ["newestObservedVersion", "minimumSupportedVersion", "installedVersion"])
      toolchain.core.vscode[field] = "1.140.0";
    toolchain.core.vscode.postCutoffObservation.version = "1.140.0";
    toolchain.compatibilitySet.minimumVscode = "1.140.0";
  });
  assert.equal(hasRule(accepted, "toolchain.vscode-minimum"), false);
});

test("rejects permissive or non-object contract union branches", () => {
  for (const mutation of [
    (branch) => {
      branch.additionalProperties = true;
    },
    (branch) => {
      branch.type = "string";
    },
  ]) {
    const result = mutate((model) => {
      const schema = model.contracts.schemas.find(({ value }) => Array.isArray(value.anyOf)).value;
      mutation(schema.anyOf[0]);
    });
    assert.ok(hasRule(result, "contracts.schema-shape"));
  }
});
