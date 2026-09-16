#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const local = join(root, "tools/debug/.local");
const statePath = join(local, "deployment.json");
const secretPath = join(local, "client.secret");

function run(args, sensitive = false) {
  try {
    const output = execFileSync("az", [...args, "--only-show-errors", "-o", "json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
    return output.trim() ? JSON.parse(output) : null;
  } catch (error) {
    const message = sensitive
      ? `Azure credential operation failed (${args.slice(0, 3).join(" ")}); output suppressed.`
      : `az ${args.slice(0, 3).join(" ")} failed: ${error.stderr?.toString() ?? "no diagnostic"}`;
    for (const key of Object.keys(error)) delete error[key];
    error.message = message;
    error.stack = `Error: ${message}`;
    throw error;
  }
}

function save(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function readConfig(path) {
  const config = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (!/^[0-9a-f-]{36}$/iu.test(config.subscriptionId ?? "")) throw new Error("A subscriptionId is required");
  if (!/^[a-z0-9]+$/u.test(config.location ?? "")) throw new Error("A canonical Azure location is required");
  for (const field of ["resourceGroupName", "workspaceName", "insightsName", "identityName"]) {
    if (!/^[a-zA-Z][a-zA-Z0-9-]{2,62}$/u.test(config[field] ?? "")) throw new Error(`Invalid ${field}`);
  }
  return config;
}

async function prepare(config) {
  const active = run(["account", "show"]);
  const account = run(["account", "show", "--subscription", config.subscriptionId]);
  if (active.tenantId !== account.tenantId)
    throw new Error("Sign into the target tenant before provisioning its identity");
  const owner = run(["ad", "signed-in-user", "show"]).id;
  const groupExists = run([
    "group",
    "exists",
    "--name",
    config.resourceGroupName,
    "--subscription",
    config.subscriptionId,
  ]);
  if (groupExists) {
    const group = run(["group", "show", "--name", config.resourceGroupName, "--subscription", config.subscriptionId]);
    if (
      group.location !== config.location ||
      group.tags?.application !== "apex-insights" ||
      group.tags?.environment !== "dev"
    ) {
      throw new Error("Existing group is not a matching APEX development monitoring group");
    }
  }
  const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
  if (
    previous &&
    (previous.config.subscriptionId !== config.subscriptionId ||
      previous.config.resourceGroupName !== config.resourceGroupName ||
      previous.config.identityName !== config.identityName)
  ) {
    throw new Error("This checkout is bound to another deployment; use a separate checkout for another target");
  }
  const parameters = {
    resourceGroupName: { value: config.resourceGroupName },
    location: { value: config.location },
    workspaceName: { value: config.workspaceName },
    insightsName: { value: config.insightsName },
    resourceTags: { value: config.resourceTags ?? {} },
    credentialOwnerObjectId: { value: owner },
    publisherObjectId: { value: previous?.principalId ?? "" },
  };
  const parametersPath = join(local, "parameters.json");
  save(parametersPath, { parameters });
  run(["bicep", "build", "--file", "infra/bicep/apex-insights/main.bicep", "--outfile", join(local, "main.json")]);
  const deploymentArgs = [
    "--subscription",
    config.subscriptionId,
    "--name",
    `${config.resourceGroupName}-deploy`,
    "--location",
    config.location,
    "--template-file",
    join(local, "main.json"),
    "--parameters",
    `@${parametersPath}`,
  ];
  run(["deployment", "sub", "validate", ...deploymentArgs]);
  const preview = run([
    "deployment",
    "sub",
    "what-if",
    ...deploymentArgs,
    "--result-format",
    "ResourceIdOnly",
    "--no-pretty-print",
  ]);
  const changes = preview.changes ?? preview.properties?.changes;
  if (!Array.isArray(changes)) throw new Error("What-if returned no change list");
  if (changes.some((change) => change.changeType === "Delete"))
    throw new Error("What-if contains deletions; refusing deployment");
  console.log(
    JSON.stringify(
      changes.map((change) => ({ change: change.changeType, resource: change.resourceId })),
      null,
      2,
    ),
  );
  return { account, parameters, parametersPath, deploymentArgs, previous };
}

async function deploy(config, prepared) {
  let state = prepared.previous;
  if (!state) {
    const matches = run(["ad", "app", "list", "--display-name", config.identityName]).filter(
      (app) => app.displayName === config.identityName,
    );
    if (matches.length) throw new Error("An unbound app with this name already exists; refuse automatic adoption");
    const app = run([
      "ad",
      "app",
      "create",
      "--display-name",
      config.identityName,
      "--sign-in-audience",
      "AzureADMyOrg",
    ]);
    state = { config, tenantId: prepared.account.tenantId, appId: app.appId, appObjectId: app.id };
    save(statePath, state);
  }
  if (!state.principalId) {
    const matches = run(["ad", "sp", "list", "--filter", `appId eq '${state.appId}'`]);
    const principal = matches[0] ?? run(["ad", "sp", "create", "--id", state.appId]);
    state.principalId = principal.id;
    save(statePath, state);
  }
  prepared.parameters.publisherObjectId.value = state.principalId;
  save(prepared.parametersPath, { parameters: prepared.parameters });
  run(["deployment", "sub", "validate", ...prepared.deploymentArgs]);
  const preview = run([
    "deployment",
    "sub",
    "what-if",
    ...prepared.deploymentArgs,
    "--result-format",
    "ResourceIdOnly",
    "--no-pretty-print",
  ]);
  const changes = preview.changes ?? preview.properties?.changes;
  if (!Array.isArray(changes) || changes.some((change) => change.changeType === "Delete"))
    throw new Error("Final identity-bound preview is not safe to apply");
  const deployment = run(["deployment", "sub", "create", ...prepared.deploymentArgs]);
  if (deployment.properties.provisioningState !== "Succeeded") throw new Error("Deployment did not succeed");
  state = { ...state, config, outputs: deployment.properties.outputs, deployedAt: new Date().toISOString() };
  save(statePath, state);
  console.log(
    `Deployed ${config.resourceGroupName} in ${config.location}. Identity: ${state.appId}. Credentials are managed separately.`,
  );
}

function credentials() {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (!state.outputs) throw new Error("Deploy successfully before issuing a credential");
  const pendingPath = join(local, "pending-credential.json");
  let pending;
  if (existsSync(pendingPath)) {
    pending = JSON.parse(readFileSync(pendingPath, "utf8"));
    if (Date.parse(pending.expiresAt) <= Date.now())
      throw new Error("Pending credential has expired; review and remove it before issuing another");
    console.log("Resuming storage of the existing pending credential.");
  } else {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/u, "Z");
    const credential = run(
      [
        "ad",
        "app",
        "credential",
        "reset",
        "--id",
        state.appId,
        "--append",
        "--display-name",
        `apex-debug-${expiresAt.slice(0, 10)}`,
        "--end-date",
        expiresAt,
      ],
      true,
    );
    pending = { password: credential.password, expiresAt };
    save(pendingPath, pending);
  }
  const connection = run(
    ["resource", "show", "--ids", state.outputs.applicationInsightsResourceId.value, "--api-version", "2020-02-02"],
    true,
  ).properties.ConnectionString;
  const templatePath = join(local, "credential-template.json");
  const parametersPath = join(local, "credential-parameters.json");
  run(["bicep", "build", "--file", "infra/bicep/apex-insights/credential.bicep", "--outfile", templatePath]);
  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  if (
    template.parameters.secretValue.type.toLowerCase() !== "securestring" ||
    Object.keys(template.outputs ?? {}).length
  ) {
    throw new Error("Credential template must use secureString with no outputs");
  }
  const secretName = `${state.config.identityName}-client-secret`;
  const deploymentArgs = [
    "--subscription",
    state.config.subscriptionId,
    "--resource-group",
    state.config.resourceGroupName,
    "--name",
    "apex-insights-credential",
    "--template-file",
    templatePath,
    "--parameters",
    `@${parametersPath}`,
  ];
  try {
    save(parametersPath, {
      parameters: {
        vaultName: { value: state.outputs.vaultName.value },
        secretName: { value: secretName },
        secretValue: { value: pending.password },
        expiresAt: { value: Math.floor(Date.parse(pending.expiresAt) / 1000) },
      },
    });
    run(["deployment", "group", "validate", ...deploymentArgs], true);
    const preview = run(
      ["deployment", "group", "what-if", ...deploymentArgs, "--result-format", "ResourceIdOnly", "--no-pretty-print"],
      true,
    );
    const changes = preview.changes ?? preview.properties?.changes;
    if (!Array.isArray(changes) || changes.some((change) => change.changeType === "Delete"))
      throw new Error("Credential preview contains unexpected changes");
    const deployment = run(["deployment", "group", "create", ...deploymentArgs], true);
    if (deployment.properties.provisioningState !== "Succeeded")
      throw new Error("Credential storage deployment did not succeed");
  } finally {
    if (existsSync(parametersPath)) unlinkSync(parametersPath);
  }
  const environment = {
    AZURE_TENANT_ID: state.tenantId,
    AZURE_CLIENT_ID: state.appId,
    AZURE_CLIENT_SECRET: pending.password,
    APPLICATIONINSIGHTS_CONNECTION_STRING: connection,
  };
  for (const value of Object.values(environment)) {
    if (typeof value !== "string" || /[\r\n]/u.test(value)) throw new Error("Invalid collector environment value");
  }
  const environmentPath = join(local, "collector.env");
  writeFileSync(
    environmentPath,
    `${Object.entries(environment)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
  chmodSync(environmentPath, 0o600);
  save(statePath, { ...state, credentialExpiresAt: pending.expiresAt });
  if (existsSync(secretPath)) unlinkSync(secretPath);
  unlinkSync(pendingPath);
  console.log(
    `Credential stored in Key Vault and local mode-0600 collector.env. Expires ${pending.expiresAt}. Secret value not displayed.`,
  );
}

async function main() {
  const [action, configPath, confirm, ...extra] = process.argv.slice(2);
  if (
    !["plan", "deploy", "credentials"].includes(action) ||
    !configPath ||
    extra.length ||
    (confirm && confirm !== "--confirm")
  ) {
    throw new Error(
      "Usage: node tools/scripts/deploy-debug-insights.mjs plan|deploy|credentials CONFIG.json [--confirm]",
    );
  }
  if (action !== "plan" && confirm !== "--confirm")
    throw new Error("Mutating operations require --confirm after reviewing the plan");
  const config = readConfig(configPath);
  mkdirSync(local, { recursive: true, mode: 0o700 });
  chmodSync(local, 0o700);
  mkdirSync(join(local, "queue"), { recursive: true, mode: 0o700 });
  if (action === "credentials") {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (
      state.config.subscriptionId !== config.subscriptionId ||
      state.config.resourceGroupName !== config.resourceGroupName ||
      state.config.identityName !== config.identityName
    )
      throw new Error("Credential target differs from local deployment binding");
    credentials();
    return;
  }
  const prepared = await prepare(config);
  if (action === "deploy") await deploy(config, prepared);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
