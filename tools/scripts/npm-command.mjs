import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

/**
 * Returns `[executable, args]` that run npm without a shell. On Windows `npm` is a `.cmd` shim that a shell-less spawn
 * cannot start, so run npm's own CLI script with the current Node binary when it can be found.
 */
export function npmCommand(args, { env = process.env, execPath = process.execPath } = {}) {
  const candidates = [env.npm_execpath, join(dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js")];
  const cli = candidates.find((path) => typeof path === "string" && /\.(?:c|m)?js$/u.test(path) && existsSync(path));
  return cli === undefined ? ["npm", args] : [execPath, [cli, ...args]];
}
