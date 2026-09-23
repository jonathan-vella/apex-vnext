#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PACKAGE = "@azure/mcp";
const CLI_MANIFEST = "packages/cli/package.json";

function latestVersion() {
  try {
    const output = execFileSync("npm", ["view", `${PACKAGE}@latest`, "version", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const raw = JSON.parse(output);
    const value = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
    if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)) {
      throw new Error("registry returned an invalid version");
    }
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(`Unable to read ${PACKAGE} latest version: ${message}`, { cause: error });
  }
}

const manifest = JSON.parse(readFileSync(CLI_MANIFEST, "utf8"));
const declared = manifest.dependencies?.[PACKAGE];
if (typeof declared !== "string" || !/^\d+\.\d+\.\d+-beta\.\d+$/u.test(declared)) {
  throw new Error(`${CLI_MANIFEST} must pin an exact ${PACKAGE} beta version`);
}
const latest = latestVersion();
if (declared !== latest) {
  throw new Error(`${PACKAGE} is ${declared}; npm latest is ${latest}. Upgrade and qualify the new beta.`);
}
console.log(`${PACKAGE} is current at ${declared}`);
