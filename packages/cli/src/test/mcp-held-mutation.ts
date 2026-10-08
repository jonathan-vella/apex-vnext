/**
 * Test-only preload (`node --import`) for a real `apex mcp serve` process. `createProject` announces on stderr that the
 * mutation has started, then holds it until the server's stdin has ended, so the stdio transport is closed while the
 * mutation is still in flight. Only then does the real mutation run. Never import this module from a test process.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { ApexService } from "../service.js";

const createProject = ApexService.prototype.createProject;

ApexService.prototype.createProject = async function (this: ApexService, input) {
  process.stderr.write("apex-test: held mutation entered\n");
  while (!process.stdin.readableEnded && !process.stdin.destroyed) await sleep(10);
  return createProject.call(this, input);
};
