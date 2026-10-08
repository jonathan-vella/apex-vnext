import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** The part of @resvg/resvg-js and its native binding that diagram rasterization uses. */
export interface ResvgBinding {
  readonly Resvg: new (svg: string) => { render(): { asPng(): Uint8Array } };
}

export interface BundledRasterizerBinary {
  /** Path of the `.node` file relative to `root`. */
  readonly file: string;
  readonly sha256: string;
  /** Set for Linux binaries that need the GNU C library; musl hosts fall back to SVG output. */
  readonly libc?: "glibc";
}

/**
 * The native rasterizer table the plugin build inlines into the MCP bundle as the JSON string `__APEX_PLUGIN_NATIVE__`. Keys are
 * `${process.platform}-${process.arch}`. Pinning the hashes in the bundle means the binaries beside it cannot be
 * swapped without changing the bundle, which the plugin tree hash covers.
 */
export interface BundledRasterizerManifest {
  readonly package: string;
  readonly version: string;
  /** Directory URL of the binaries, relative to the bundle file. */
  readonly root: string;
  readonly binaries: Readonly<Record<string, BundledRasterizerBinary>>;
}

export interface RasterizerHost {
  readonly platform: string;
  readonly arch: string;
  readonly glibc: boolean;
  readonly dlopen: (path: string) => unknown;
}

declare const __APEX_PLUGIN_NATIVE__: string | undefined;

const unavailable = "SVG output is available";

function glibcRuntime(): boolean {
  if (process.platform !== "linux") return false;
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return typeof report?.header?.glibcVersionRuntime === "string";
}

function currentHost(): RasterizerHost {
  return {
    platform: process.platform,
    arch: process.arch,
    get glibc() {
      return glibcRuntime();
    },
    dlopen: (path) => {
      const module = { exports: {} };
      process.dlopen(module, path);
      return module.exports;
    },
  };
}

/**
 * Loads the native binding the plugin ships for this host. The binary is hashed before it is loaded; a missing,
 * replaced or unsupported binary throws so the caller writes SVG only and reports PNG as unavailable.
 */
export function loadBundledRasterizer(
  manifest: BundledRasterizerManifest,
  base: string | URL,
  host: RasterizerHost = currentHost(),
): ResvgBinding {
  const target = `${host.platform}-${host.arch}`;
  const binary = Object.hasOwn(manifest.binaries, target) ? manifest.binaries[target] : undefined;
  if (binary === undefined)
    throw new Error(`PNG rasterizer ${manifest.package} is not bundled for ${target}; ${unavailable}`);
  if (binary.libc === "glibc" && !host.glibc)
    throw new Error(`PNG rasterizer ${manifest.package} for ${target} needs glibc; ${unavailable}`);
  const path = fileURLToPath(new URL(`${manifest.root}${binary.file}`, base));
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new Error(`PNG rasterizer ${manifest.package} binary for ${target} is missing; ${unavailable}`, {
      cause: error,
    });
  }
  if (createHash("sha256").update(bytes).digest("hex") !== binary.sha256)
    throw new Error(
      `PNG rasterizer ${manifest.package} binary for ${target} failed its integrity check; ${unavailable}`,
    );
  const binding = host.dlopen(path) as Partial<ResvgBinding> | undefined;
  if (typeof binding?.Resvg !== "function")
    throw new Error(`PNG rasterizer ${manifest.package} binary for ${target} has no Resvg export; ${unavailable}`);
  return binding as ResvgBinding;
}

const requireModule = createRequire(import.meta.url);
let resvg: ResvgBinding | undefined;

// The npm CLI resolves @resvg/resvg-js and its platform package from node_modules. The plugin's single-file MCP bundle
// has no node_modules, so the plugin build ships the binaries beside it and inlines their table into the bundle.
function loadResvg(): ResvgBinding {
  if (resvg !== undefined) return resvg;
  if (typeof __APEX_PLUGIN_NATIVE__ !== "undefined") {
    resvg = loadBundledRasterizer(JSON.parse(__APEX_PLUGIN_NATIVE__) as BundledRasterizerManifest, import.meta.url);
    return resvg;
  }
  try {
    resvg = requireModule("@resvg/resvg-js") as ResvgBinding;
    return resvg;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND")
      throw new Error(`PNG rasterizer @resvg/resvg-js is not installed; ${unavailable}`);
    throw error;
  }
}

export function rasterizeDiagram(svg: string): Uint8Array {
  return new (loadResvg().Resvg)(svg).render().asPng();
}
