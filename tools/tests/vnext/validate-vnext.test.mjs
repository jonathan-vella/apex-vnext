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

test("rejects a subagent model escalation", () => {
  const result = mutate((model) => {
    model.customization.manifest.roles.find(({ agent }) => agent === "APEX Reviewer").costTier = "premium";
  });
  assert.ok(hasRule(result, "customization.model-escalation"));
});

test("CLI distinguishes interactive handoffs from supported subagent edges", () => {
  const result = mutate((model) => {
    model.customization.manifest.invocationEdges.find(
      ({ from, to }) => from === "APEX" && to === "APEX Requirements",
    ).type = "subagent";
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

test("rejects ask_user on an autonomous subagent", () => {
  const result = mutate((model) => {
    model.customization.agents
      .find(({ frontmatter }) => frontmatter.name === "APEX Reviewer")
      .frontmatter.tools.push("ask_user");
  });
  assert.ok(hasRule(result, "customization.subagent-questions"));
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
      retire(model.customization.agents.find(({ frontmatter }) => frontmatter.name === "APEX Planner").frontmatter);
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

test("rejects a PATH-dependent MCP launch", () => {
  const result = mutate((model) => {
    model.customization.vscodeMcp.servers.apex.command = "apex";
    model.customization.vscodeMcp.servers.apex.args = ["mcp", "serve"];
  });
  assert.ok(hasRule(result, "mcp.launch"));
});

test("rejects ARM and Azure MCP launch drift", () => {
  const endpointResult = mutate((model) => {
    model.customization.vscodeMcp.servers["azure-resource-manager-mcp"].url = "https://example.invalid";
  });
  assert.ok(hasRule(endpointResult, "mcp.arm-launch"));

  const toolsetResult = mutate((model) => {
    model.customization.vscodeMcp.servers["azure-resource-manager-mcp"].headers["x-mcp-toolset"] = "Pricing";
  });
  assert.ok(hasRule(toolsetResult, "mcp.arm-launch"));

  const allowlistResult = mutate((model) => {
    model.customization.cliMcp.mcpServers["azure-resource-manager-mcp"].tools.push("create_budget");
  });
  assert.ok(hasRule(allowlistResult, "mcp.cli-arm-launch"));

  const azureMcpResult = mutate((model) => {
    model.customization.vscodeMcp.servers["azure-mcp-server"].args[0] =
      "${workspaceFolder}/node_modules/@azure/mcp/index.js";
  });
  assert.ok(hasRule(azureMcpResult, "mcp.azure-launch"));

  const azureMcpPackageResult = mutate((model) => {
    model.packages.cli.manifest.dependencies["@azure/mcp"] = "3.0.0-beta.38";
  });
  assert.ok(hasRule(azureMcpPackageResult, "mcp.azure-package"));

  const serverSetResult = mutate((model) => {
    model.customization.vscodeMcp.servers.extra = { type: "stdio" };
  });
  assert.ok(hasRule(serverSetResult, "mcp.vscode-server-set"));
});

test("rejects client projection declaration and CLI allowlist drift", () => {
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

  const allowlistResult = mutate((model) => {
    model.customization.cliMcp.mcpServers.apex.tools.pop();
  });
  assert.ok(hasRule(allowlistResult, "mcp.cli-launch"));

  const launchResult = mutate((model) => {
    model.customization.cliMcp.mcpServers.apex.args = ["node_modules/@apexops/cli/dist/cli.js", "mcp", "serve"];
  });
  assert.ok(hasRule(launchResult, "mcp.cli-launch"));
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
