import { sha256Bytes } from "@apexops/kernel";
import { readBundledFile, resolveBundledAssets } from "./assets.js";

const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export interface BundledToolchainMinimums {
  vscode?: string | undefined;
  copilotCli?: string | undefined;
  azd?: string | undefined;
}

/** Client minimums and the exact azd pin from the verified bundled toolchain; empty when the bundle fails verification. */
export async function bundledToolchainMinimums(): Promise<BundledToolchainMinimums> {
  try {
    const assets = await resolveBundledAssets();
    const entry = assets.manifest.files.find(({ path }) => path === "config/toolchain.v1.json");
    const bytes = entry === undefined ? undefined : await readBundledFile(assets.root, entry.path);
    if (entry === undefined || bytes === undefined || sha256Bytes(bytes) !== entry.sha256) return {};
    const set = (
      JSON.parse(bytes.toString("utf8")) as {
        compatibilitySet?: { minimumVscode?: unknown; copilotCli?: unknown; azd?: unknown };
      }
    ).compatibilitySet;
    const release = (value: unknown) => (typeof value === "string" && RELEASE_VERSION.test(value) ? value : undefined);
    return { vscode: release(set?.minimumVscode), copilotCli: release(set?.copilotCli), azd: release(set?.azd) };
  } catch {
    return {};
  }
}
