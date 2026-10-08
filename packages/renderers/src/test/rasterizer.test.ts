import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { loadBundledRasterizer, type BundledRasterizerManifest, type RasterizerHost } from "../rasterizer.js";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>';
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

class FakeResvg {
  constructor(readonly svg: string) {}
  render() {
    return { asPng: () => Uint8Array.from(pngSignature) };
  }
}

async function fixture(context: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "apex-rasterizer-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from("not a real binary");
  await writeFile(join(directory, "binding.node"), bytes);
  const manifest: BundledRasterizerManifest = {
    package: "@resvg/resvg-js",
    version: "2.6.2",
    root: "native/",
    binaries: {
      "linux-x64": {
        file: "binding.node",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        libc: "glibc",
      },
      "win32-x64": { file: "binding.node", sha256: createHash("sha256").update(bytes).digest("hex") },
    },
  };
  const opened: string[] = [];
  const host = (platform: string, arch: string, glibc = true): RasterizerHost => ({
    platform,
    arch,
    glibc,
    dlopen: (path) => {
      opened.push(path);
      return { Resvg: FakeResvg };
    },
  });
  return { base: pathToFileURL(join(directory, "mcp", "apex.mjs")), directory, manifest, host, opened };
}

test("the bundled rasterizer loads the hashed binary for the host platform", async (context) => {
  const { base, directory, manifest, host, opened } = await fixture(context);
  for (const platform of ["linux", "win32"]) {
    const binding = loadBundledRasterizer({ ...manifest, root: "../" }, base, host(platform, "x64"));
    assert.deepEqual([...new binding.Resvg(svg).render().asPng()], pngSignature);
  }
  assert.deepEqual(opened, [join(directory, "binding.node"), join(directory, "binding.node")]);
});

test("the bundled rasterizer refuses unsupported, musl, missing and tampered binaries before loading", async (context) => {
  const { base, directory, manifest, host, opened } = await fixture(context);
  const root = { ...manifest, root: "../" };
  assert.throws(
    () => loadBundledRasterizer(root, base, host("darwin", "arm64")),
    /^Error: PNG rasterizer @resvg\/resvg-js is not bundled for darwin-arm64; SVG output is available$/u,
  );
  assert.throws(() => loadBundledRasterizer(root, base, host("linux", "arm64")), /not bundled for linux-arm64/u);
  assert.throws(
    () => loadBundledRasterizer(root, base, host("linux", "x64", false)),
    /for linux-x64 needs glibc; SVG output is available/u,
  );
  assert.throws(
    () => loadBundledRasterizer({ ...root, root: "../missing/" }, base, host("linux", "x64")),
    /binary for linux-x64 is missing; SVG output is available/u,
  );
  await writeFile(join(directory, "binding.node"), "replaced");
  assert.throws(
    () => loadBundledRasterizer(root, base, host("win32", "x64")),
    /binary for win32-x64 failed its integrity check; SVG output is available/u,
  );
  assert.deepEqual(opened, [], "no binary is loaded unless it matches its pinned hash");
});

test("the bundled rasterizer rejects a binary without the Resvg export", async (context) => {
  const { base, manifest, host } = await fixture(context);
  const empty = { ...host("linux", "x64"), dlopen: () => ({}) };
  assert.throws(() => loadBundledRasterizer({ ...manifest, root: "../" }, base, empty), /has no Resvg export/u);
});

test("the bundled rasterizer renders a PNG with the installed platform binary", async (context) => {
  const require = createRequire(import.meta.url);
  const scope = dirname(dirname(require.resolve("@resvg/resvg-js/package.json")));
  const candidates: { file: string; sha256: string }[] = [];
  for (const name of (await readdir(scope)).filter((entry) => entry.startsWith("resvg-js-")).sort()) {
    for (const file of (await readdir(join(scope, name))).filter((entry) => entry.endsWith(".node"))) {
      const bytes = await readFile(join(scope, name, file));
      candidates.push({ file: `${name}/${file}`, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  }
  if (candidates.length === 0) {
    context.skip("npm installed no @resvg/resvg-js platform package for this host");
    return;
  }
  const manifest: BundledRasterizerManifest = {
    package: "@resvg/resvg-js",
    version: "2.6.2",
    root: "./",
    binaries: { [`${process.platform}-${process.arch}`]: candidates[0]! },
  };
  const binding = loadBundledRasterizer(manifest, pathToFileURL(join(scope, "index.js")));
  assert.deepEqual([...new binding.Resvg(svg).render().asPng().slice(0, 8)], pngSignature);
});
