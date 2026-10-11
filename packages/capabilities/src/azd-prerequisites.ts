export type AzdPrerequisiteCode =
  "AZD_NOT_FOUND" | "AZD_PIN_UNAVAILABLE" | "AZD_VERSION_MISMATCH" | "AZD_VERSION_UNAVAILABLE";

export interface AzdPrerequisiteInput {
  /** Exact azd release selected in the bundled toolchain, or undefined when the bundle does not carry it. */
  readonly pinnedVersion: string | undefined;
  readonly found: boolean;
  /** Stable `major.minor.patch` that `azd version` reported, or undefined when it could not be read. */
  readonly installedVersion: string | undefined;
}

export interface AzdPrerequisiteResult {
  readonly ok: boolean;
  readonly code?: AzdPrerequisiteCode;
  readonly value: string;
  readonly remedy?: string;
}

const INSTALL_DOCS = "https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd";

function releaseUrl(version: string): string {
  return `https://github.com/Azure/azure-dev/releases/tag/azure-dev-cli_${version}`;
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

const COMPARATOR = /^(>=|<=|!=|>|<|=)?\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?/u;

/**
 * Evaluates the comparator subset of azure.yaml `requiredVersions.azd` (`>=`, `>`, `<=`, `<`, `=`, `!=`, spaces or commas
 * for "and", `||` for "or") for a release version. Returns undefined for any other syntax so callers fail closed.
 */
export function satisfiesAzdVersionConstraint(version: string, constraint: string): boolean | undefined {
  const release = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (release === null) return undefined;
  const actual = [Number(release[1]), Number(release[2]), Number(release[3])] as const;
  let satisfied = false;
  for (const group of constraint.split("||")) {
    let rest = group.trim();
    if (rest.length === 0) return undefined;
    let groupSatisfied = true;
    while (rest.length > 0) {
      const match = COMPARATOR.exec(rest);
      if (match === null) return undefined;
      const wanted = [Number(match[2]), Number(match[3]), Number(match[4])] as const;
      // A release outranks a pre-release of the same version.
      let order = compareVersions(actual.join("."), wanted.join("."));
      if (order === 0 && match[5] !== undefined) order = 1;
      const operator = match[1] ?? "=";
      const holds =
        operator === ">="
          ? order >= 0
          : operator === ">"
            ? order > 0
            : operator === "<="
              ? order <= 0
              : operator === "<"
                ? order < 0
                : operator === "!="
                  ? order !== 0
                  : order === 0;
      groupSatisfied &&= holds;
      rest = rest.slice(match[0].length).replace(/^[\s,]+/u, "");
    }
    satisfied ||= groupSatisfied;
  }
  return satisfied;
}

/**
 * Bicep runs execute through the Azure Developer CLI, and the bound azd version is part of what the user approved, so
 * only the exact pinned release satisfies the prerequisite. Terraform runs do not require azd.
 */
export function evaluateAzdPrerequisite(input: AzdPrerequisiteInput): AzdPrerequisiteResult {
  const { pinnedVersion, found, installedVersion } = input;
  if (pinnedVersion === undefined)
    return {
      ok: false,
      code: "AZD_PIN_UNAVAILABLE",
      value: "bundled azd version unavailable",
      remedy: "Reinstall the apex CLI package",
    };
  const install = `Install azd ${pinnedVersion} (${releaseUrl(pinnedVersion)}; install guide ${INSTALL_DOCS}), add it to PATH, then rerun doctor`;
  if (!found)
    return { ok: false, code: "AZD_NOT_FOUND", value: "not found on PATH; Bicep runs require azd", remedy: install };
  if (installedVersion === undefined)
    return {
      ok: false,
      code: "AZD_VERSION_UNAVAILABLE",
      value: "version unavailable from azd version",
      remedy: `Run azd version to confirm it reports a stable release; ${install}`,
    };
  if (installedVersion === pinnedVersion) return { ok: true, value: installedVersion };
  const direction = compareVersions(installedVersion, pinnedVersion) < 0 ? "older" : "newer";
  return {
    ok: false,
    code: "AZD_VERSION_MISMATCH",
    value: `${installedVersion} is ${direction} than the pinned ${pinnedVersion}`,
    remedy: `Bicep runs bind the exact azd version; ${install}`,
  };
}
