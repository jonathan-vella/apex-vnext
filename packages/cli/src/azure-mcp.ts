import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";
import { azureMcpEnvironment } from "./azure-mcp-environment.js";

const require = createRequire(import.meta.url);
const azureMcpEntrypoint = require.resolve("@azure/mcp");
const child = spawn(process.execPath, [azureMcpEntrypoint, "server", "start"], {
  stdio: "inherit",
  env: azureMcpEnvironment(process.env),
});

child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
