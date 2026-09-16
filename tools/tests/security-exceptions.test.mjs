import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { securityExceptionIssues } from "../scripts/_lib/security-exceptions.mjs";

const exception = {
  id: "sandbox-runner-ip",
  control: "public-network-access",
  requested_at: "2026-07-15T12:00:00.000Z",
  expires_at: "2026-07-16T12:00:00.000Z",
  reason: "Allow one ephemeral runner address for a bounded qualification.",
  issue_link: "https://github.com/jonathan-vella/apex-vnext/issues/543",
  compensating_controls: ["Default-deny firewall"],
};

test("development monitoring vault stays private without a security exception", () => {
  const source = readFileSync("infra/bicep/apex-insights/resources.bicep", "utf8");
  assert.match(source, /var devTags = union\(tags, \{ environment: 'dev' \}\)/);
  assert.match(source, /publicNetworkAccess: 'Disabled'/);
  assert.doesNotMatch(source, /publicNetworkAccess: 'Enabled'/);
  assert.match(source, /defaultAction: 'Deny'/);
  assert.match(source, /bypass: 'None'/);
  assert.match(source, /ipRules: \[\]/);
  assert.doesNotMatch(source, /developerIpCidr/);
});

test("collector credential storage uses secure ARM parameters without data-plane access", () => {
  const template = readFileSync("infra/bicep/apex-insights/credential.bicep", "utf8");
  const script = readFileSync("tools/scripts/deploy-debug-insights.mjs", "utf8");
  assert.match(template, /@secure\(\)\s+param secretValue string/);
  assert.match(template, /value: secretValue/);
  assert.doesNotMatch(template, /^output /m);
  assert.match(script, /"deployment", "group", "create"/);
  assert.doesNotMatch(script, /"keyvault", "secret", "set"/);
  assert.match(script, /finally\s*\{\s*if \(existsSync\(parametersPath\)\) unlinkSync\(parametersPath\)/);
  assert.match(script, /"--append"/);
  assert.match(script, /mode: 0o600/);
  assert.match(script, /for \(const key of Object.keys\(error\)\) delete error\[key\]/);
});

test("security exception requires one current matching governance record", () => {
  const now = new Date("2026-07-15T13:00:00.000Z");
  assert.deepEqual(securityExceptionIssues([exception], exception.id, exception.control, now), []);
  assert.match(securityExceptionIssues([], exception.id, exception.control, now)[0], /exactly one/);
  assert.ok(securityExceptionIssues([exception, exception], exception.id, exception.control, now).length > 0);
  assert.ok(securityExceptionIssues([exception], exception.id, "other-control", now).length > 0);
  assert.ok(
    securityExceptionIssues([exception], exception.id, exception.control, new Date(exception.expires_at)).length > 0,
  );
});

test("qualification backend is policy-compliant at rest without broad Azure service bypass", () => {
  const source = readFileSync("infra/bicep/vnext-qualification/bootstrap.bicep", "utf8");
  assert.match(source, /publicNetworkAccess: 'Disabled'/);
  assert.doesNotMatch(source, /SecurityControl/);
  assert.match(source, /bypass: 'Logging, Metrics'/);
  assert.doesNotMatch(source, /bypass: 'AzureServices/);
  assert.match(source, /defaultAction: 'Deny'/);
  assert.match(source, /92aaf0da-9dab-42b6-94a3-d43ce8d16293/);
  assert.doesNotMatch(source, /73c42c96-874c-492b-b04d-ab87d138a893/);
  assert.equal(source.match(/principalId: handoffUploaderPrincipalId/g)?.length, 3);
  assert.equal(source.match(/roleDefinitionIdOrName: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'/g)?.length, 4);
});
