import { isAbsolute } from "node:path";
import type { AzdBindingV1, AzdExecutionEnvelopeV1 } from "@apexops/contracts";
import { AzdBindingError } from "./azd-project-files.js";

const POSIX_INHERITED = ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"] as const;
const WINDOWS_INHERITED = [
  "APPDATA",
  "ComSpec",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "windir",
] as const;

const HOME_VARIABLES = new Set(["HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE"]);

export interface AzdEnvelopeRequest {
  readonly environmentName: string;
  /** Platform that will run azd; selects the small set of variables a process needs to start. */
  readonly platform?: NodeJS.Platform;
  /**
   * `inherited-user-default` (the default) leaves Azure CLI state ambient: the user's home and `~/.azure` are used,
   * so only the identity preflight constrains it. `isolated-directory` is for CI and production executors.
   */
  readonly azureCliState?: AzdExecutionEnvelopeV1["azureCliState"];
  readonly cloud?: AzdExecutionEnvelopeV1["identityPreflight"]["cloud"];
  /** The approved target the identity preflight compares against. */
  readonly target: { readonly tenantId: string; readonly subscriptionId: string };
}

/**
 * The only way to run azd for a bound project: an explicit environment, the project root as working directory, no
 * prompts, a minimal allowlisted process environment and a run-scoped azd configuration directory (which also holds
 * extensions), so neither the user's azd state nor inherited `AZURE_*`/`AZD_*` variables can change what runs.
 * Azure CLI state is isolated only in `isolated-directory` mode; by default it is ambient and the executor must pass
 * the identity preflight (`assertAzdIdentityMatchesBinding`) before provisioning.
 */
export function buildAzdExecutionEnvelope(request: AzdEnvelopeRequest): AzdExecutionEnvelopeV1 {
  const azureCliState = request.azureCliState ?? "inherited-user-default";
  const inherited = [...((request.platform ?? process.platform) === "win32" ? WINDOWS_INHERITED : POSIX_INHERITED)];
  return {
    workingDirectory: "project-root",
    environmentName: request.environmentName,
    prompts: "disabled",
    inheritedEnvironment:
      azureCliState === "isolated-directory"
        ? inherited.filter((name) => !HOME_VARIABLES.has(name.toUpperCase()))
        : inherited,
    fixedEnvironment: { AZD_SKIP_UPDATE_CHECK: "true", AZURE_DEV_COLLECT_TELEMETRY: "no" },
    azdConfigDirectory: "isolated",
    azureCliState,
    userHome: azureCliState === "isolated-directory" ? "withheld" : "inherited",
    identityPreflight: {
      cloud: request.cloud ?? "AzureCloud",
      tenantId: request.target.tenantId,
      subscriptionId: request.target.subscriptionId,
      onMismatch: "stop",
    },
  };
}

export interface AzdProcessDirectories {
  /** Run-scoped `AZD_CONFIG_DIR`; never the user's own azd directory. */
  readonly azdConfigDirectory: string;
  /** Required exactly when the envelope declares `isolated-directory`. */
  readonly azureCliConfigDirectory?: string;
}

function invalid(message: string): never {
  throw new AzdBindingError("AZD_BINDING_INPUT_INVALID", message);
}

/** The complete environment for the azd process. Nothing is inherited beyond the envelope's allowlist. */
export function resolveAzdProcessEnvironment(
  envelope: AzdExecutionEnvelopeV1,
  parent: NodeJS.ProcessEnv,
  directories: AzdProcessDirectories,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  if (!isAbsolute(directories.azdConfigDirectory))
    invalid("The azd configuration directory must be an absolute run-scoped path");
  const isolated = envelope.azureCliState === "isolated-directory";
  if (isolated !== (directories.azureCliConfigDirectory !== undefined))
    invalid("The Azure CLI configuration directory must be supplied exactly when the envelope declares it isolated");
  if (directories.azureCliConfigDirectory !== undefined && !isAbsolute(directories.azureCliConfigDirectory))
    invalid("The Azure CLI configuration directory must be an absolute path");
  const environment: Record<string, string> = {};
  for (const name of envelope.inheritedEnvironment) {
    if (/^(?:AZURE|AZD)_/iu.test(name)) invalid("The envelope may not inherit AZURE_* or AZD_* variables");
    const key =
      platform === "win32"
        ? Object.keys(parent).find((candidate) => candidate.toUpperCase() === name.toUpperCase())
        : name;
    const value = key === undefined ? undefined : parent[key];
    if (key !== undefined && value !== undefined) environment[key] = value;
  }
  Object.assign(environment, envelope.fixedEnvironment);
  environment.AZD_CONFIG_DIR = directories.azdConfigDirectory;
  if (directories.azureCliConfigDirectory !== undefined)
    environment.AZURE_CONFIG_DIR = directories.azureCliConfigDirectory;
  return environment;
}

/** azd arguments for the operations a bound project supports; `azd up` and every other command are unrepresentable. */
export function buildAzdArguments(
  envelope: AzdExecutionEnvelopeV1,
  operation: "provision-preview" | "provision",
): string[] {
  if (operation !== "provision-preview" && operation !== "provision")
    invalid("Only azd provision can be run for a bound project");
  const command = operation === "provision-preview" ? ["provision", "--preview"] : ["provision"];
  return [...command, "--environment", envelope.environmentName, "--no-prompt"];
}

export interface ObservedAzdExtension {
  readonly id: string;
  readonly version: string;
  readonly source: string;
  readonly installedDigest: string;
}

/**
 * Preflight check the executor must pass before running azd: exactly the bound extensions are installed in the
 * isolated configuration directory, from the default registry, with the digests recorded in the binding.
 */
export function assertAzdExtensionsVerified(
  binding: Pick<AzdBindingV1, "extensions">,
  observed: readonly ObservedAzdExtension[],
): void {
  const fail = (message: string): never => {
    throw new AzdBindingError("AZD_EXTENSION_UNVERIFIED", message);
  };
  for (const bound of binding.extensions) {
    const installed = observed.filter(({ id }) => id === bound.id);
    if (installed.length !== 1)
      fail(`azd extension ${bound.id} is not installed exactly once in the isolated azd configuration`);
    const [actual] = installed;
    if (actual!.source !== bound.source || actual!.version !== bound.version)
      fail(`azd extension ${bound.id} is not the bound ${bound.version} from the default registry`);
    if (actual!.installedDigest !== bound.installedDigest)
      fail(`azd extension ${bound.id} does not match the digest bound at preview`);
  }
  const extra = observed.filter(({ id }) => !binding.extensions.some((bound) => bound.id === id));
  if (extra.length > 0) fail(`azd has ${extra.length} extension(s) installed that the binding does not list`);
}

/** Identity the executor observed from the Azure CLI and azd immediately before running azd. */
export interface ObservedAzdIdentity {
  /** Active cloud name, for example `az cloud show`. */
  readonly cloud?: string;
  /** Tenant of the signed-in session azd will use. */
  readonly tenantId?: string;
  /** Subscription azd will use (the environment's `AZURE_SUBSCRIPTION_ID` as resolved by azd). */
  readonly subscriptionId?: string;
  /** Default subscription of the Azure CLI session, which hooks calling `az` run against. */
  readonly azureCliDefaultSubscriptionId?: string;
}

/**
 * Identity preflight the executor must pass before every provision: the cloud, tenant and subscription azd and the
 * Azure CLI report must equal the approved target. A missing or different value stops the run; values are never echoed.
 */
export function assertAzdIdentityMatchesBinding(
  observed: ObservedAzdIdentity,
  binding: Pick<AzdBindingV1, "executionEnvelope">,
): void {
  const expected = binding.executionEnvelope.identityPreflight;
  const fail = (message: string): never => {
    throw new AzdBindingError("AZD_IDENTITY_MISMATCH", message);
  };
  const check = (name: string, actual: string | undefined, wanted: string, fold: boolean): void => {
    if (typeof actual !== "string" || actual.length === 0)
      fail(`The active Azure ${name} was not reported; sign in to the approved target and run the preflight again`);
    else if ((fold ? actual.toLowerCase() : actual) !== wanted)
      fail(`The active Azure ${name} does not match the approved target; sign in to the approved target`);
  };
  check("cloud", observed.cloud, expected.cloud, false);
  check("tenant", observed.tenantId, expected.tenantId, true);
  check("subscription", observed.subscriptionId, expected.subscriptionId, true);
  check("CLI default subscription", observed.azureCliDefaultSubscriptionId, expected.subscriptionId, true);
}
