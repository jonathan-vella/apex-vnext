import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ProcessRunnerError, type ProcessRequest } from "@apexops/capabilities";
import { sha256Json } from "@apexops/kernel";

/** Test doubles for the azd executor: no real azd, az or Azure is ever invoked. */
export const AZD_VERSION = "1.35.1";
export const AZD_SUBSCRIPTION = "11111111-1111-1111-1111-111111111111";
export const AZD_TENANT = "22222222-2222-2222-2222-222222222222";
export const AZD_GROUP = "rg";
export const AZD_SCOPE = `/subscriptions/${AZD_SUBSCRIPTION}/resourceGroups/${AZD_GROUP}`;
export const AZD_ENVIRONMENT = "dev";
export const AZD_MAIN = "targetScope = 'resourceGroup'\n";
export const BICEP_CONFIG = `${JSON.stringify({ experimentalFeaturesEnabled: { symbolicNameCodegen: true } }, null, 2)}\n`;
export const AZURE_YAML = "name: project\ninfra:\n  provider: bicep\n  path: infra\n  module: main\n";

export interface FakeAzdResource {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly location?: string;
  /** Child resources are readable by ID but absent from `az resource list`. */
  readonly unlisted?: boolean;
}

export interface FakeAzdState {
  /** Output of `azd version`; undefined makes azd missing from PATH. */
  version: string | undefined;
  account: { environmentName: string; tenantId: string; id: string };
  groups: { name: string; tags: Record<string, string> }[];
  resources: FakeAzdResource[];
  /** Entries `azd provision --preview --output json` reports. */
  preview: { Operation: string; Type: string; Name: string }[];
  /** Makes `az resource list` fail the way Azure reports a deleted resource group. */
  groupMissing: boolean;
  /** Replaces the whole preview stdout when set. */
  previewStdout: string | undefined;
  /** Runs while azd is previewing, for tests that mutate inputs mid-run. */
  duringPreview: (() => Promise<void>) | undefined;
  /** Runs when azd provisions or destroys. */
  duringExecute: (() => Promise<void>) | undefined;
  readonly calls: ProcessRequest[];
}

export function resourceId(type: string, name: string, group = AZD_GROUP): string {
  const [namespace, ...types] = type.split("/");
  const names = name.split("/");
  return `/subscriptions/${AZD_SUBSCRIPTION}/resourceGroups/${group}/providers/${namespace}/${types
    .map((segment, index) => `${segment}/${names[index]}`)
    .join("/")}`;
}

export function createFakeAzd(overrides: Partial<FakeAzdState> = {}): FakeAzdState {
  return {
    version: `azd version ${AZD_VERSION} (commit 0123456789abcdef)`,
    account: { environmentName: "AzureCloud", tenantId: AZD_TENANT, id: AZD_SUBSCRIPTION },
    groups: [{ name: AZD_GROUP, tags: { "azd-env-name": AZD_ENVIRONMENT } }],
    resources: [],
    preview: [],
    groupMissing: false,
    previewStdout: undefined,
    duringPreview: undefined,
    duringExecute: undefined,
    calls: [],
    ...overrides,
  };
}

export function azdPreviewStdout(operations: readonly { Operation: string; Type: string; Name: string }[]): string {
  const event = (data: unknown) => JSON.stringify({ type: "consoleMessage", timestamp: "2026-07-13T01:00:00Z", data });
  return [
    event({ message: "Previewing Azure resource changes (azd provision --preview)" }),
    event(operations.length === 0 ? null : operations.map((operation) => ({ ...operation, PropertyDeltas: null }))),
  ].join("\n");
}

/** Answers the azd, az and bicep-free commands the Bicep executor issues; undefined when the command is not one. */
export async function handleFakeAzd(state: FakeAzdState, request: ProcessRequest): Promise<string | undefined> {
  if (request.executable === "azd") {
    state.calls.push(request);
    if (request.args[0] === "version") {
      if (state.version === undefined) {
        throw new ProcessRunnerError("PROCESS_SPAWN_ERROR", "spawn azd ENOENT");
      }
      return state.version;
    }
    if (request.args.includes("--preview")) {
      await state.duringPreview?.();
      return state.previewStdout ?? azdPreviewStdout(state.preview);
    }
    await state.duringExecute?.();
    return "";
  }
  if (request.executable === "az") {
    state.calls.push(request);
    if (request.args[0] === "account") return JSON.stringify(state.account);
    if (request.args[0] === "group") return JSON.stringify(state.groups);
    if (request.args[0] === "resource" && request.args[1] === "show") {
      const found = state.resources.find(({ id }) => id.toLowerCase() === request.args[3]!.toLowerCase());
      if (found === undefined) {
        throw new ProcessRunnerError("PROCESS_EXIT_NONZERO", "az failed", {
          exitCode: 3,
          signal: null,
          stdout: "",
          stderr: "(ResourceNotFound) The Resource was not found.",
          timedOut: false,
          outputTruncated: false,
        });
      }
      return JSON.stringify(found);
    }
    if (request.args[0] === "resource") {
      if (state.groupMissing) {
        throw new ProcessRunnerError("PROCESS_EXIT_NONZERO", "az failed", {
          exitCode: 3,
          signal: null,
          stdout: "",
          stderr: "(ResourceGroupNotFound) Resource group 'rg' could not be found.",
          timedOut: false,
          outputTruncated: false,
        });
      }
      return JSON.stringify(state.resources.filter(({ unlisted }) => unlisted !== true));
    }
  }
  return undefined;
}

/** Writes the generated azd project and returns the tree digest the accepted handoff would carry. */
export async function writeAzdProject(
  root: string,
  main = AZD_MAIN,
  azureYaml = AZURE_YAML,
): Promise<{ readonly files: readonly { path: string; content: string }[]; readonly treeHash: string }> {
  const files = [
    { path: "azure.yaml", content: azureYaml },
    { path: "infra/bicepconfig.json", content: BICEP_CONFIG },
    { path: "infra/main.bicep", content: main },
  ];
  for (const file of files) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
  return { files, treeHash: sha256Json(files) };
}
