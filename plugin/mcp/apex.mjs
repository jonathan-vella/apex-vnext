import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
// eslint-disable-next-line n/no-missing-import -- the plugin build copies this bundled runtime path into the package.
import { createApexService, resolveMcpWorkspace, serveMcp } from "../runtime/node_modules/@apexops/cli/dist/index.js";

const fallbackPluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(process.env.PLUGIN_ROOT ?? fallbackPluginRoot);
const defaultService = await createApexService(pluginRoot, {}, "mcp serve");
const cache = new Map([[defaultService.root, defaultService]]);

await serveMcp({
  defaultService,
  resolve: async (workspace) => {
    const resolved = await resolveMcpWorkspace(workspace);
    let service = cache.get(resolved.root);
    if (service === undefined) {
      service = await createApexService(resolved.root, {}, "mcp serve", {
        workspacePath: resolved.workspace,
      });
      cache.set(resolved.root, service);
    }
    return { service, workspace: resolved.workspace };
  },
});
