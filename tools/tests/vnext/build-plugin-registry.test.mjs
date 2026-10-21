import assert from "node:assert/strict";
import test from "node:test";
import { tarballDownloadUrl } from "../../scripts/build-plugin.mjs";

const resolved = "https://registry.npmjs.org/@resvg/resvg-js-linux-x64-gnu/-/resvg-js-linux-x64-gnu-2.6.2.tgz";

test("a tarball keeps its lockfile URL when no registry is configured", () => {
  assert.equal(tarballDownloadUrl(resolved, {}), resolved);
});

test("a configured https registry replaces the public registry host and keeps the path", () => {
  assert.equal(
    tarballDownloadUrl(resolved, { npm_config_registry: "https://packagefeedproxy.microsoft.io/npm/" }),
    "https://packagefeedproxy.microsoft.io/npm/@resvg/resvg-js-linux-x64-gnu/-/resvg-js-linux-x64-gnu-2.6.2.tgz",
  );
  assert.equal(
    tarballDownloadUrl(resolved, { npm_config_registry: "https://feed.example.test/npm" }),
    "https://feed.example.test/npm/@resvg/resvg-js-linux-x64-gnu/-/resvg-js-linux-x64-gnu-2.6.2.tgz",
  );
});

test("the public registry setting is an identity replacement", () => {
  assert.equal(tarballDownloadUrl(resolved, { npm_config_registry: "https://registry.npmjs.org/" }), resolved);
});

test("a non-https registry is ignored", () => {
  assert.equal(tarballDownloadUrl(resolved, { npm_config_registry: "http://feed.example.test/npm/" }), resolved);
});

test("a lockfile URL outside the public registry is left alone", () => {
  const other = "https://example.test/pkg.tgz";
  assert.equal(tarballDownloadUrl(other, { npm_config_registry: "https://feed.example.test/npm/" }), other);
});

test("a registry value that is not a URL is ignored", () => {
  assert.equal(tarballDownloadUrl(resolved, { npm_config_registry: "not a url" }), resolved);
});

test("a registry with embedded credentials is rejected without echoing the secret", () => {
  for (const registry of [
    "https://user:s3cr3t-token@feed.example.test/npm/",
    "https://s3cr3t-token@feed.example.test/npm/",
  ]) {
    assert.throws(
      () => tarballDownloadUrl(resolved, { npm_config_registry: registry }),
      (error) => {
        assert.match(error.message, /must not embed credentials/u);
        assert.doesNotMatch(error.message, /s3cr3t-token|feed\.example\.test/u);
        return true;
      },
    );
  }
});

test("a query string or fragment on the registry is dropped", () => {
  assert.equal(
    tarballDownloadUrl(resolved, { npm_config_registry: "https://feed.example.test/npm/?x=1#y" }),
    "https://feed.example.test/npm/@resvg/resvg-js-linux-x64-gnu/-/resvg-js-linux-x64-gnu-2.6.2.tgz",
  );
});
