import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import type { ArchetypeBatchConfigV1, GovernanceSetupConfigV1, OnboardingConfigV1 } from "@apexops/contracts";
import { ApexService } from "./service.js";
import { ApexError, EXIT_CODES } from "./errors.js";

export interface BootstrapInteraction {
  ask(question: string): Promise<string>;
  show(value: unknown): void;
}

type SetupService = Pick<
  ApexService,
  | "listArchetypes"
  | "planArchetypeBatch"
  | "importArchetypeBatch"
  | "planBootstrap"
  | "bootstrap"
  | "planGovernanceSetup"
  | "inspectGovernanceBaselineReadiness"
>;

export async function runBootstrapWizard(
  root: string,
  interaction: BootstrapInteraction,
  serviceAt: (directory: string) => SetupService = (directory) => new ApexService(directory),
) {
  const progress: Array<{ directory: string; step: string; outcome: unknown }> = [];
  const ask = async (question: string) => {
    const value = (await interaction.ask(question)).trim();
    if (value.toLowerCase() === "cancel") throw new Error("BOOTSTRAP_CANCELLED");
    if (value.length > 4096)
      throw new ApexError("APEX_VALIDATION", "Bootstrap answer exceeds the input budget", EXIT_CODES.validation);
    return value;
  };
  const choose = async (question: string, values: readonly string[], fallback?: string): Promise<string> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const value = (await ask(question)) || fallback;
      if (value !== undefined && values.includes(value)) return value;
      interaction.show(`Choose one of: ${values.join(", ")}. Enter cancel to stop.`);
    }
    throw new ApexError("APEX_VALIDATION", "Bootstrap choice remains invalid", EXIT_CODES.validation);
  };
  const confirm = async (question: string) =>
    (await choose(`${question} [yes/no, default no]: `, ["yes", "no"], "no")) === "yes";
  try {
    interaction.show(
      "APEX repository bootstrap. Enter cancel at any question to stop. Never enter tokens, passwords or client secrets.",
    );
    const client = (await choose(
      "Client [both/github-copilot-vscode/github-copilot-cli, default both]: ",
      ["both", "github-copilot-vscode", "github-copilot-cli"],
      "both",
    )) as OnboardingConfigV1["client"];
    let directories = [root];
    if (await confirm("Copy one or more independent workloads from a remote COE?")) {
      const repository = await ask("Remote COE HTTPS URL (https://github.com/OWNER/REPO): ");
      const revision = await ask("Exact 40-character source commit: ");
      const catalogPath = (await ask("Catalog directory [archetypes]: ")) || "archetypes";
      const service = serviceAt(root);
      const catalog = await service.listArchetypes(repository, revision, catalogPath);
      interaction.show(
        catalog.candidates.map(({ selectedPath }, index) => ({ selection: index + 1, path: selectedPath })),
      );
      const selection = await ask("Select workload numbers separated by commas: ");
      if (!/^[1-9][0-9]*(?:\s*,\s*[1-9][0-9]*)*$/.test(selection))
        throw new ApexError(
          "APEX_VALIDATION",
          "Workload selection must contain exact listed numbers",
          EXIT_CODES.validation,
        );
      const indexes = selection.split(",").map((value) => Number(value.trim()) - 1);
      if (
        new Set(indexes).size !== indexes.length ||
        indexes.length > 16 ||
        indexes.some((index) => !catalog.candidates[index])
      )
        throw new ApexError(
          "APEX_VALIDATION",
          "Workload selection is duplicated or outside the catalog",
          EXIT_CODES.validation,
        );
      const selections: ArchetypeBatchConfigV1["selections"] = [];
      for (const index of indexes) {
        const selectedPath = catalog.candidates[index]!.selectedPath;
        selections.push({
          selectedPath,
          destination: await ask(`Independent destination folder for ${selectedPath}: `),
        });
      }
      const config: ArchetypeBatchConfigV1 = { schemaVersion: "1.0.0", repository, revision, selections };
      const plan = await service.planArchetypeBatch(config);
      interaction.show(plan);
      if (!(await confirm("Copy exactly these reviewed files and exclusions?")))
        return { status: "pending", progress, nextAction: "COE copy was not confirmed." };
      const copied = await service.importArchetypeBatch(config, plan.planHash, true);
      progress.push({ directory: root, step: "coe-copy", outcome: copied });
      if (copied.status === "blocked") return { status: "blocked", progress, nextAction: copied.nextAction };
      directories = selections.map(({ destination }) => join(root, destination));
    }
    for (const directory of directories) {
      interaction.show({ workspace: directory });
      const projectId = await ask("Project ID (lowercase letters, numbers and hyphens): ");
      const environment = (await ask("Environment [dev]: ")) || "dev";
      const targetScope = (await ask("Azure target scope, or local for offline setup [local]: ")) || "local";
      const iacTool = (await choose(
        "IaC track [bicep/terraform, default bicep]: ",
        ["bicep", "terraform"],
        "bicep",
      )) as "bicep" | "terraform";
      const createRepository = await confirm("Initialize a local Git repository if none exists here?");
      const config: OnboardingConfigV1 = {
        schemaVersion: "1.0.0",
        projectId,
        environment,
        targetScope,
        iacTool,
        ...(client === undefined ? {} : { client }),
        createRepository,
      };
      const service = serviceAt(directory);
      const plan = await service.planBootstrap(config);
      interaction.show(plan);
      if (plan.status === "blocked")
        return {
          status: "blocked",
          progress,
          nextAction: "Resolve the local bootstrap blockers; existing files were preserved.",
        };
      if (!(await confirm("Install the exact workspace runtime and initialize or resume this project?")))
        return { status: "pending", progress, nextAction: "Local project setup was not confirmed." };
      const initialized = await service.bootstrap({
        projectId,
        environment,
        targetScope,
        iacTool,
        createRepository,
        ...(client === undefined ? {} : { clientId: client }),
      });
      progress.push({ directory, step: "local-bootstrap", outcome: initialized });
      const governance = await choose(
        "Governance source [consumer/central/later, default later]: ",
        ["consumer", "central", "later"],
        "later",
      );
      if (governance === "consumer") {
        const repository = await ask("Consumer GitHub repository (OWNER/REPOSITORY): ");
        const tenantId = await ask("Azure tenant ID: ");
        const subscriptionId = await ask("Login and standalone collection subscription ID: ");
        const managementGroupId = await ask("Management-group collection ID, or blank for subscription: ");
        const mode = await choose("Identity [reuse/create]: ", ["reuse", "create"]);
        const identity: GovernanceSetupConfigV1["identity"] =
          mode === "reuse"
            ? {
                mode,
                clientId: await ask("Approved application client ID: "),
                principalId: await ask("Approved service-principal object ID: "),
              }
            : { mode: "create", displayName: await ask("Proposed dedicated application display name: ") };
        const setup = await service.planGovernanceSetup({
          schemaVersion: "1.0.0",
          repository,
          tenantId,
          subscriptionId,
          identity,
          ...(managementGroupId ? { managementGroupId } : {}),
        });
        interaction.show(setup);
        progress.push({ directory, step: "governance-plan", outcome: setup });
      } else if (governance === "central") {
        const path = await ask("Reviewed central baseline JSON path in this workspace: ");
        const readiness = await service.inspectGovernanceBaselineReadiness(path);
        interaction.show(readiness);
        progress.push({ directory, step: "central-baseline-check", outcome: readiness });
      } else {
        progress.push({
          directory,
          step: "governance",
          outcome: {
            status: "pending",
            source: governance,
            nextAction:
              governance === "central"
                ? "Select and import the current reviewed central baseline using the governance workflow."
                : "Configure governance before planning infrastructure.",
          },
        });
      }
    }
    const blocked = progress.some(
      ({ outcome }) =>
        outcome !== null && typeof outcome === "object" && "status" in outcome && outcome.status === "blocked",
    );
    return {
      status: blocked ? "blocked" : "pending",
      progress,
      nextAction:
        "Local setup is complete. Review adopted workload decisions and complete client health, GitHub and governance prerequisites. No deployment is authorized.",
    };
  } catch (error) {
    return {
      status: error instanceof Error && error.message === "BOOTSTRAP_CANCELLED" ? "cancelled" : "blocked",
      progress,
      nextAction:
        error instanceof ApexError
          ? error.message
          : "Setup stopped; completed steps were preserved. Inspect prerequisites before retrying.",
    };
  }
}

export async function interactiveBootstrap(root: string) {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new ApexError(
      "APEX_USAGE",
      "bootstrap wizard requires an interactive terminal; use typed plan commands for automation",
      EXIT_CODES.usage,
    );
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    return await runBootstrapWizard(root, {
      ask: (question) => terminal.question(question),
      show: (value) => stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`),
    });
  } finally {
    terminal.close();
  }
}
