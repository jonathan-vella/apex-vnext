import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadValidator } from "../scripts/_lib/ajv-validator.mjs";

const collector = resolve("tools/scripts/collect-governance-baseline.ps1");
const validateBaseline = loadValidator("tools/schemas/governance-baseline.schema.json");
const arm = "https://management.azure.com";
const subscriptionId = "11111111-1111-1111-1111-111111111111";
const subscriptionScope = `/subscriptions/${subscriptionId}`;
const managementGroupScope = "/providers/Microsoft.Management/managementGroups/test-root";
const descendantsUrl = `${arm}${managementGroupScope}/descendants?api-version=2020-05-01`;
const subscriptionUrl = `${arm}${subscriptionScope}?api-version=2022-12-01`;
const authorization = `${arm}${subscriptionScope}/providers/Microsoft.Authorization`;
const assignmentsUrl = `${authorization}/policyAssignments?$filter=atScope()&api-version=2022-06-01`;
const definitionsUrl = `${authorization}/policyDefinitions?api-version=2021-06-01`;
const setsUrl = `${authorization}/policySetDefinitions?api-version=2021-06-01`;
const exemptionsUrl = `${authorization}/policyExemptions?$filter=atScope()&api-version=2022-07-01-preview`;
const pwsh = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
  encoding: "utf8",
});
const powershellOptions = { skip: pwsh.error?.code === "ENOENT" ? "pwsh unavailable; PowerShell not executed" : false };

function routes() {
  return {
    [descendantsUrl]: {
      value: [{ name: subscriptionId, type: "Microsoft.Management/managementGroups/subscriptions" }],
    },
    [subscriptionUrl]: { state: "Enabled" },
    [assignmentsUrl]: { value: [] },
    [definitionsUrl]: { value: [] },
    [setsUrl]: { value: [] },
    [exemptionsUrl]: { value: [] },
  };
}

function collect(context, responses, options = {}) {
  const output = mkdtempSync(join(tmpdir(), "apex-governance-collector-"));
  context.after(() => rmSync(output, { recursive: true, force: true }));
  const baselinePath = join(output, "governance-policy-baseline.json");
  const rawPath = join(output, "governance-policy-raw.json");
  const prior = options.prior ?? '{"previous":"baseline must survive failures"}';
  if (!options.fresh) {
    writeFileSync(baselinePath, prior);
    writeFileSync(rawPath, prior);
  }
  const result = spawnSync(
    "pwsh",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `
      $ErrorActionPreference = "Stop"
      function ConvertTo-Json {
        param([Parameter(ValueFromPipeline)]$InputObject, [int]$Depth, [switch]$Compress)
        process {
          if ($env:COLLECTOR_FAULT -eq "serialize" -and $Depth -eq 50 -and
              $InputObject.schema_version -eq "governance-baseline-v1") {
            throw "offline serialization failure"
          }
          Microsoft.PowerShell.Utility\\ConvertTo-Json -InputObject $InputObject -Depth $Depth -Compress:$Compress
        }
      }
      function Set-Content {
        param([Parameter(ValueFromPipeline)]$Value, [string]$Path, [string]$LiteralPath, [switch]$NoNewline)
        process {
          $target = if ($LiteralPath) { $LiteralPath } else { $Path }
          $isRaw = [System.IO.Path]::GetFileName($target) -eq "governance-policy-raw.json"
          if ([System.IO.Path]::GetFullPath([System.IO.Path]::GetDirectoryName($target)) -ne $env:COLLECTOR_OUTPUT) {
            throw "Output must be staged in the destination directory"
          }
          if (($env:COLLECTOR_FAULT -eq "write" -and -not $isRaw) -or
              ($env:COLLECTOR_FAULT -eq "raw" -and $isRaw)) {
            Microsoft.PowerShell.Management\\Set-Content -LiteralPath $target -Value "partial write" -NoNewline
            throw "offline write failure"
          }
          Microsoft.PowerShell.Management\\Set-Content -LiteralPath $target -Value $Value -NoNewline:$NoNewline
          if ($env:COLLECTOR_FAULT -eq "rename" -and -not $isRaw -and
              [System.IO.Path]::GetFileName($target) -ne "governance-policy-baseline.json") {
            Remove-Item -LiteralPath $target -Force
          }
        }
      }
        $responses = @{}
        foreach ($route in ($env:COLLECTOR_RESPONSES | ConvertFrom-Json -AsHashtable).GetEnumerator()) {
          $responses[$route.Key] = $route.Value
        }
      function az {
        Write-Host "TOKEN REQUEST"
            $global:LASTEXITCODE = [int]$env:COLLECTOR_TOKEN_EXIT
            return $env:COLLECTOR_TOKEN
      }
      function Invoke-RestMethod {
          param($Uri, $Headers, $Method, $ErrorAction)
        if ($Headers.Authorization -cne "Bearer test-token" -or $Method -ne "Get") {
              throw "Unexpected offline authentication or method"
            }
          if (-not $responses.ContainsKey([string]$Uri)) { throw "Unexpected offline request: $Uri" }
            Write-Host "REQUEST $Uri"
          $response = $responses[[string]$Uri]
            if ($null -ne $response -and $response.ContainsKey("failure")) { throw $response.failure }
          return ($response | ConvertTo-Json -Depth 50 | ConvertFrom-Json)
      }
          $rootParameters = $env:COLLECTOR_ROOT | ConvertFrom-Json -AsHashtable
          & $env:COLLECTOR_SCRIPT @rootParameters -OutputDir $env:COLLECTOR_OUTPUT -MaxSubscriptions ([int]$env:COLLECTOR_CAP)
      `,
    ],
    {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        COLLECTOR_SCRIPT: collector,
        COLLECTOR_OUTPUT: output,
        COLLECTOR_RESPONSES: JSON.stringify(responses),
        COLLECTOR_CAP: String(options.cap ?? 100),
        COLLECTOR_ROOT: JSON.stringify(options.root ?? { ManagementGroupId: "test-root" }),
        COLLECTOR_TOKEN: JSON.stringify(options.token ?? { accessToken: "test-token" }),
        COLLECTOR_TOKEN_EXIT: String(options.tokenExit ?? 0),
        COLLECTOR_FAULT: options.fault ?? "",
      },
    },
  );
  return {
    ...result,
    prior: options.fresh ? undefined : prior,
    baseline: existsSync(baselinePath) ? readFileSync(baselinePath, "utf8") : undefined,
    baselineBytes: existsSync(baselinePath) ? readFileSync(baselinePath) : undefined,
    raw: existsSync(rawPath) ? readFileSync(rawPath, "utf8") : undefined,
    files: readdirSync(output).sort(),
  };
}

function assertAborted(result, message) {
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, message);
  assert.equal(result.baseline, result.prior);
  assert.equal(result.raw, result.prior);
}

function assertComplete(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const baseline = JSON.parse(result.baseline);
  assert.equal(validateBaseline(baseline), true, JSON.stringify(validateBaseline.errors));
  assert.equal(baseline.coverage_status, "COMPLETE");
  assert.deepEqual(JSON.parse(result.raw), baseline);
  for (const envelope of Object.values(baseline.subscriptions)) {
    const summary = envelope.discovery_summary;
    assert.equal(
      summary.classified_policy_count,
      envelope.findings.length + summary.audit_count + summary.disabled_count + summary.other_effect_count,
    );
  }
  return baseline;
}

for (const fresh of [false, true]) {
  for (const fault of ["serialize", "write", "rename"]) {
    test(
      `atomic publication ${fault} failure preserves ${fresh ? "absent" : "prior"} baseline`,
      powershellOptions,
      (context) => {
        const prior = '\uFEFF{ "previous": "unchanged bytes" }\r\n';
        const result = collect(context, routes(), { fault, fresh, prior });
        const message = {
          serialize: /offline serialization failure/,
          write: /offline write failure/,
          rename: /Exception calling "Move"/,
        }[fault];
        assertAborted(result, message);
        assert.deepEqual(result.baselineBytes, fresh ? undefined : Buffer.from(prior));
        assert.deepEqual(result.files, fresh ? [] : ["governance-policy-baseline.json", "governance-policy-raw.json"]);
        assert.doesNotMatch(result.stdout, /Wrote baseline:|Done\. Coverage:/);
      },
    );
  }
}

test("atomic publication succeeds on first collection without staging litter", powershellOptions, (context) => {
  const result = collect(context, routes(), { fresh: true });
  assertComplete(result);
  assert.deepEqual(result.files, ["governance-policy-baseline.json", "governance-policy-raw.json"]);
});

test("atomic publication remains successful when optional raw debug write fails", powershellOptions, (context) => {
  const result = collect(context, routes(), { fault: "raw" });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.notEqual(result.baseline, result.prior);
  const baseline = JSON.parse(result.baseline);
  assert.equal(validateBaseline(baseline), true, JSON.stringify(validateBaseline.errors));
  assert.equal(baseline.coverage_status, "COMPLETE");
  assert.match(result.stdout + result.stderr, /WARNING:.*raw debug.*offline write failure/i);
  assert.match(result.stdout, /Done\. Coverage: COMPLETE/);
  assert.deepEqual(result.files, ["governance-policy-baseline.json", "governance-policy-raw.json"]);
});

test(
  "standalone evidenced-empty collection has exclusive root and no descendant request",
  powershellOptions,
  (context) => {
    const responses = routes();
    delete responses[descendantsUrl];
    const result = collect(context, responses, { root: { SubscriptionId: subscriptionId } });
    const baseline = assertComplete(result);
    assert.equal(baseline.subscription_id, subscriptionId);
    assert.equal(Object.hasOwn(baseline, "management_group_id"), false);
    assert.equal(baseline.subscriptions_discovered, 1);
    assert.equal(baseline.subscriptions_processed, 1);
    const envelope = baseline.subscriptions[subscriptionId];
    assert.equal(envelope.source, "github-actions-baseline");
    assert.equal(envelope.discovery_status, "COMPLETE");
    assert.equal(envelope.discovery_metadata.scope.subscription_id, subscriptionId);
    assert.equal(envelope.discovery_summary.assignment_total, 0);
    assert.deepEqual(envelope.findings, []);
    for (const url of [subscriptionUrl, assignmentsUrl, definitionsUrl, setsUrl, exemptionsUrl]) {
      assert.ok(result.stdout.includes(`REQUEST ${url}`));
    }
  },
);

for (const url of [subscriptionUrl, assignmentsUrl, definitionsUrl, setsUrl, exemptionsUrl]) {
  test(`standalone failure at ${url} preserves output`, powershellOptions, (context) => {
    const responses = routes();
    responses[url] = { failure: "offline standalone failure" };
    assertAborted(
      collect(context, responses, { root: { SubscriptionId: subscriptionId } }),
      /offline standalone failure/,
    );
  });
}

for (const root of [
  { SubscriptionId: "invalid" },
  { SubscriptionId: subscriptionId, ManagementGroupId: "test-root" },
]) {
  test(`invalid standalone root ${JSON.stringify(root)} fails before requests`, powershellOptions, (context) => {
    const result = collect(context, routes(), { root });
    assertAborted(result, /SubscriptionId|parameter set/i);
    assert.doesNotMatch(result.stdout, /REQUEST /);
  });
}

for (const detail of [{}, { state: "Disabled" }, { state: "Enabled", subscriptionPolicies: { quotaId: "AAD_test" } }]) {
  test(`standalone ineligible subscription ${JSON.stringify(detail)} fails closed`, powershellOptions, (context) => {
    const responses = routes();
    responses[subscriptionUrl] = detail;
    assertAborted(
      collect(context, responses, { root: { SubscriptionId: subscriptionId }, fresh: true }),
      /Standalone subscription/,
    );
  });
}

for (const managementGroupId of ["a", "9", "Az09-_.(group)", "group-", "group_", "a".repeat(90)]) {
  test(`valid management-group ID ${JSON.stringify(managementGroupId)} is collected`, powershellOptions, (context) => {
    const responses = routes();
    const url = `${arm}/providers/Microsoft.Management/managementGroups/${managementGroupId}/descendants?api-version=2020-05-01`;
    responses[url] = responses[descendantsUrl];
    delete responses[descendantsUrl];
    const result = collect(context, responses, { root: { ManagementGroupId: managementGroupId } });
    assert.equal(assertComplete(result).management_group_id, managementGroupId);
    assert.ok(result.stdout.includes(`REQUEST ${url}`));
  });
}

for (const managementGroupId of [
  "",
  "a".repeat(91),
  "group/child",
  "group?query",
  "group#fragment",
  "group%2Fchild",
  "group\\child",
  " group",
  "group ",
  "group name",
  "group\tname",
  "group\rname",
  "group\nname",
  "group\n",
  "group\u00a0name",
  "-group",
  "_group",
  ".group",
  "(group)",
  "group.",
]) {
  test(
    `invalid management-group ID ${JSON.stringify(managementGroupId)} fails before token or REST requests`,
    powershellOptions,
    (context) => {
      const result = collect(context, routes(), { root: { ManagementGroupId: managementGroupId } });
      assertAborted(result, /ManagementGroupId/);
      assert.doesNotMatch(result.stdout, /TOKEN REQUEST|REQUEST /);
    },
  );
}

for (const [endpoint, url] of Object.entries({
  descendants: descendantsUrl,
  assignments: assignmentsUrl,
  definitions: definitionsUrl,
  initiatives: setsUrl,
  exemptions: exemptionsUrl,
})) {
  for (const laterPage of [false, true]) {
    test(
      `${endpoint} ${laterPage ? "continuation" : "first"} page failure aborts publication`,
      powershellOptions,
      (context) => {
        const responses = routes();
        const failureUrl = laterPage ? `${url}&$skiptoken=second` : url;
        if (laterPage) responses[url].nextLink = failureUrl;
        responses[failureUrl] = { failure: "offline page failure" };
        assertAborted(collect(context, responses), /offline page failure/);
      },
    );
  }
}

function definition(id) {
  return {
    id,
    properties: {
      displayName: "Deny public access",
      policyRule: { if: { field: "publicNetworkAccess", equals: "Enabled" }, then: { effect: "Deny" } },
    },
  };
}

function assignment(policyDefinitionId, scope = managementGroupScope, name = "inherited") {
  return {
    id: `${scope}/providers/Microsoft.Authorization/policyAssignments/${name}`,
    properties: { displayName: name, scope, policyDefinitionId },
  };
}

for (const ageDays of [29, 30, 31]) {
  test(`unchanged ${ageDays}-day-old baseline renews freshness`, powershellOptions, (context) => {
    const responses = routes();
    const policyId = `${managementGroupScope}/providers/Microsoft.Authorization/policyDefinitions/inherited-deny`;
    responses[assignmentsUrl].value = [assignment(policyId)];
    responses[definitionsUrl].value = [definition(policyId)];
    const prior = assertComplete(collect(context, responses));
    const oldTimestamp = new Date(Date.now() - ageDays * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const priorEnvelope = prior.subscriptions[subscriptionId];
    priorEnvelope.discovered_at = oldTimestamp;
    priorEnvelope.discovery_metadata.discovered_at = oldTimestamp;
    priorEnvelope.discovery_metadata.ttl_days = 7;

    const startedAt = Math.floor(Date.now() / 1000) * 1000;
    const refreshed = assertComplete(collect(context, responses, { prior: JSON.stringify(prior) }));
    const envelope = refreshed.subscriptions[subscriptionId];
    assert.equal(envelope.discovery_metadata.discovered_at, envelope.discovered_at);
    assert.ok(Date.parse(envelope.discovered_at) >= startedAt);
    assert.ok(Date.parse(envelope.discovered_at) <= Date.now());
    assert.notEqual(envelope.discovered_at, oldTimestamp);
    assert.equal(envelope.discovery_metadata.ttl_days, 30);

    priorEnvelope.discovered_at = envelope.discovered_at;
    priorEnvelope.discovery_metadata.discovered_at = envelope.discovered_at;
    priorEnvelope.discovery_metadata.ttl_days = 30;
    assert.deepEqual(refreshed, prior);
  });
}

test(
  "failed refresh preserves old evidence with zero or partially completed subscriptions",
  powershellOptions,
  (context) => {
    const responses = routes();
    const policyId = `${managementGroupScope}/providers/Microsoft.Authorization/policyDefinitions/inherited-deny`;
    responses[assignmentsUrl].value = [assignment(policyId)];
    responses[definitionsUrl].value = [definition(policyId)];
    const prior = assertComplete(collect(context, responses));
    const envelope = prior.subscriptions[subscriptionId];
    envelope.discovered_at = "2020-01-01T00:00:00Z";
    envelope.discovery_metadata.discovered_at = envelope.discovered_at;
    const priorJson = JSON.stringify(prior);

    for (const url of [descendantsUrl, assignmentsUrl]) {
      const failedResponses = structuredClone(responses);
      failedResponses[url] = { failure: "offline refresh failure" };
      assertAborted(collect(context, failedResponses, { prior: priorJson }), /offline refresh failure/);
    }

    const secondId = "22222222-2222-2222-2222-222222222222";
    responses[descendantsUrl].value.push({
      name: secondId,
      type: "Microsoft.Management/managementGroups/subscriptions",
    });
    responses[`${arm}/subscriptions/${secondId}?api-version=2022-12-01`] = { state: "Enabled" };
    responses[assignmentsUrl.replace(subscriptionId, secondId)] = { failure: "offline later refresh failure" };
    const result = collect(context, responses, { prior: priorJson });
    assertAborted(result, /offline later refresh failure/);
    assert.ok(result.stdout.includes(`REQUEST ${exemptionsUrl}`));
  },
);

for (const [initiative, standalone] of [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
]) {
  test(
    `${standalone ? "standalone" : "MG"} inherited ${initiative ? "initiative member" : "policy"} missing from subscription lists is resolved`,
    powershellOptions,
    (context) => {
      const responses = routes();
      const policyId = `${managementGroupScope}/providers/Microsoft.Authorization/policyDefinitions/inherited-deny`;
      const setId = `${managementGroupScope}/providers/Microsoft.Authorization/policySetDefinitions/inherited-set`;
      responses[assignmentsUrl].value = [assignment(initiative ? setId : policyId)];
      responses[`${arm}${policyId}?api-version=2021-06-01`] = definition(policyId);
      if (initiative) {
        responses[`${arm}${setId}?api-version=2021-06-01`] = {
          id: setId,
          properties: {
            policyDefinitions: [{ policyDefinitionId: policyId, policyDefinitionReferenceId: "deny-member" }],
          },
        };
      }
      if (standalone) delete responses[descendantsUrl];
      const result = collect(context, responses, standalone ? { root: { SubscriptionId: subscriptionId } } : {});
      const baseline = assertComplete(result);
      const envelope = baseline.subscriptions[subscriptionId];
      assert.equal(baseline.coverage_status, "COMPLETE");
      assert.equal(envelope.findings.length, 1);
      assert.equal(envelope.findings[0].policy_id, policyId);
      assert.equal(envelope.findings[0].scope, managementGroupScope);
      assert.equal(envelope.findings[0].classification, "blocker");
      assert.equal(envelope.discovery_summary.blocker_count, 1);
      assert.equal(baseline.summary.total_blockers, 1);
      assert.equal(envelope.discovery_summary.management_group_inherited_count, 1);
      assert.equal(envelope.assignment_inventory[0].assignmentType, "management-group");
      assert.deepEqual(envelope.discovery_metadata.scope.management_groups, ["test-root"]);
      for (const url of [
        subscriptionUrl,
        assignmentsUrl,
        definitionsUrl,
        setsUrl,
        exemptionsUrl,
        `${arm}${policyId}?api-version=2021-06-01`,
        ...(initiative ? [`${arm}${setId}?api-version=2021-06-01`] : []),
        ...(standalone ? [] : [descendantsUrl]),
      ]) {
        assert.ok(
          result.stdout.toLowerCase().includes(`REQUEST ${url}`.toLowerCase()),
          `Expected exact Bearer test-token authentication for ${url}`,
        );
      }
    },
  );
}

for (const [label, response, message] of [
  ["null response", null, /Invalid ARM list response/],
  ["missing value", {}, /Invalid ARM list response/],
  ["null value", { value: null }, /Invalid ARM list response/],
  ["object value", { value: {} }, /Invalid ARM list response/],
  ["error envelope", { error: { code: "Forbidden" } }, /Invalid ARM list response/],
  ["object nextLink", { value: [], nextLink: {} }, /Invalid ARM nextLink/],
  ["relative nextLink", { value: [], nextLink: "/relative" }, /Invalid ARM pagination URL/],
  ["external nextLink", { value: [], nextLink: "https://example.invalid/page" }, /Invalid ARM pagination URL/],
  ["insecure nextLink", { value: [], nextLink: "http://management.azure.com/page" }, /Invalid ARM pagination URL/],
  ["cyclic nextLink", { value: [], nextLink: assignmentsUrl }, /Repeated ARM pagination URL/],
]) {
  test(`${label} cannot produce a COMPLETE baseline`, powershellOptions, (context) => {
    const responses = routes();
    responses[assignmentsUrl] = response;
    assertAborted(collect(context, responses), message);
  });
}

test("unreadable subscription aborts without creating output", powershellOptions, (context) => {
  const responses = routes();
  responses[subscriptionUrl] = { failure: "offline subscription failure" };
  assertAborted(collect(context, responses, { fresh: true }), /offline subscription failure/);
});

for (const resourceType of ["policyDefinitions", "policySetDefinitions"]) {
  for (const malformed of [false, true]) {
    test(
      `${resourceType} ${malformed ? "malformed response" : "fetch failure"} aborts publication`,
      powershellOptions,
      (context) => {
        const responses = routes();
        const policyId = `${managementGroupScope}/providers/Microsoft.Authorization/${resourceType}/missing`;
        responses[assignmentsUrl].value = [assignment(policyId)];
        responses[`${arm}${policyId}?api-version=2021-06-01`] = malformed
          ? {}
          : { failure: "offline definition failure" };
        assertAborted(collect(context, responses), malformed ? /Invalid .* response/ : /offline definition failure/);
      },
    );
  }
}

test("a failed initiative member lookup aborts the whole subscription", powershellOptions, (context) => {
  const responses = routes();
  const policyId = "/providers/Microsoft.Authorization/policyDefinitions/builtin-deny";
  const setId = `${managementGroupScope}/providers/Microsoft.Authorization/policySetDefinitions/inherited-set`;
  responses[assignmentsUrl].value = [assignment(setId)];
  responses[setsUrl].value = [
    {
      id: setId,
      properties: { policyDefinitions: [{ policyDefinitionId: policyId, policyDefinitionReferenceId: "member" }] },
    },
  ];
  responses[`${arm}${policyId}?api-version=2021-06-01`] = { failure: "offline member failure" };
  assertAborted(collect(context, responses), /offline member failure/);
});

test("empty successful policy lists remain COMPLETE and schema-compatible", powershellOptions, (context) => {
  const baseline = assertComplete(collect(context, routes()));
  assert.equal(baseline.subscriptions_processed, 1);
  assert.equal(baseline.subscriptions[subscriptionId].discovery_summary.assignment_total, 0);
  assert.deepEqual(baseline.subscriptions[subscriptionId].findings, []);
});

test(
  "multiple assignment pages preserve inherited scope, reuse definitions and apply member exemptions",
  powershellOptions,
  (context) => {
    const responses = routes();
    const policyId = "/providers/Microsoft.Authorization/policyDefinitions/builtin-deny";
    const setId = `${managementGroupScope}/providers/Microsoft.Authorization/policySetDefinitions/inherited-set`;
    const inherited = assignment(setId);
    const nextPage = `${assignmentsUrl}&$skiptoken=second`;
    responses[assignmentsUrl] = { value: [assignment(policyId, subscriptionScope, "direct")], nextLink: nextPage };
    responses[nextPage] = { value: [inherited], nextLink: null };
    responses[`${arm}${policyId}?api-version=2021-06-01`] = definition(policyId);
    responses[`${arm}${setId}?api-version=2021-06-01`] = {
      id: setId,
      properties: {
        policyDefinitions: [
          { policyDefinitionId: policyId, policyDefinitionReferenceId: "exempt-member" },
          { policyDefinitionId: policyId, policyDefinitionReferenceId: "blocking-member" },
        ],
      },
    };
    responses[exemptionsUrl].value = [
      {
        id: `${subscriptionScope}/providers/Microsoft.Authorization/policyExemptions/inherited-waiver`,
        properties: {
          policyAssignmentId: inherited.id,
          exemptionCategory: "Waiver",
          policyDefinitionReferenceIds: ["exempt-member"],
        },
      },
    ];
    const result = collect(context, responses);
    const baseline = assertComplete(result);
    const envelope = baseline.subscriptions[subscriptionId];
    assert.equal(envelope.discovery_summary.assignment_total, 2);
    assert.equal(envelope.discovery_summary.subscription_scope_count, 1);
    assert.equal(envelope.discovery_summary.management_group_inherited_count, 1);
    assert.equal(envelope.discovery_summary.blocker_count, 2);
    assert.equal(envelope.discovery_summary.exempted_count, 1);
    assert.equal(envelope.discovery_summary.informational_count, 1);
    assert.equal(envelope.discovery_summary.classified_policy_count, 3);
    assert.equal(envelope.findings.length, 3);
    assert.equal(Object.hasOwn(envelope.findings[0], "policyDefinitionReferenceId"), false);
    assert.deepEqual(
      envelope.findings
        .slice(1)
        .map((finding) => [finding.policy_id, finding.policyDefinitionReferenceId, finding.classification]),
      [
        [policyId, "exempt-member", "informational"],
        [policyId, "blocking-member", "blocker"],
      ],
    );
    assert.deepEqual(envelope.policies, envelope.findings);
    assert.equal(
      result.stdout
        .split("\n")
        .filter((line) => line.toLowerCase() === `REQUEST ${arm}${policyId}?api-version=2021-06-01`.toLowerCase())
        .length,
      1,
    );
  },
);

for (const explicit of [false, true]) {
  test(
    `duplicate initiative policy members preserve ${explicit ? "assigned" : "default"} parameter values and all outcomes`,
    powershellOptions,
    (context) => {
      const responses = routes();
      const policyId = `${managementGroupScope}/providers/Microsoft.Authorization/policyDefinitions/parameterized`;
      const setId = `${managementGroupScope}/providers/Microsoft.Authorization/policySetDefinitions/parameterized`;
      const assigned = assignment(setId);
      const policy = definition(policyId);
      policy.properties.parameters = {
        effect: { type: "String", defaultValue: "Deny" },
        tagName: { type: "String", defaultValue: "policy-default" },
        enabled: { type: "Boolean", defaultValue: false },
        limit: { type: "Integer", defaultValue: 0 },
      };
      policy.properties.policyRule.then.effect = "[parameters('effect')]";
      policy.properties.policyRule.then.details = { value: "[parameters('tagName')]" };
      if (explicit) {
        assigned.properties.parameters = {
          initiativeTag: { value: "assigned-tag" },
          locations: { value: [] },
        };
      }
      responses[assignmentsUrl].value = [assigned];
      responses[definitionsUrl].value = [policy];
      responses[setsUrl].value = [
        {
          id: setId,
          properties: {
            parameters: {
              initiativeTag: { type: "String", defaultValue: "initiative-default" },
              locations: { type: "Array", defaultValue: ["swedencentral"] },
              settings: { type: "Object", defaultValue: { enabled: false, limit: 0 } },
            },
            policyDefinitions: [
              {
                policyDefinitionId: policyId,
                policyDefinitionReferenceId: "bound",
                parameters: { tagName: { value: "[parameters('initiativeTag')]" } },
              },
              {
                policyDefinitionId: policyId,
                policyDefinitionReferenceId: "literal",
                parameters: { tagName: { value: "member-literal" } },
              },
              ...["Audit", "Disabled", "Append"].map((effect) => ({
                policyDefinitionId: policyId,
                policyDefinitionReferenceId: effect,
                parameters: { effect: { value: effect } },
              })),
            ],
          },
        },
      ];
      const envelope = assertComplete(collect(context, responses)).subscriptions[subscriptionId];
      assert.equal(envelope.discovery_summary.assignment_kept, 1);
      assert.equal(envelope.discovery_summary.classified_policy_count, 5);
      assert.equal(envelope.discovery_summary.audit_count, 1);
      assert.equal(envelope.discovery_summary.disabled_count, 1);
      assert.equal(envelope.discovery_summary.other_effect_count, 1);
      assert.equal(envelope.findings.length, 2);
      assert.deepEqual(envelope.policies, envelope.findings);
      const initiativeTag = explicit ? "assigned-tag" : "initiative-default";
      for (const [index, reference, tagName] of [
        [0, "bound", initiativeTag],
        [1, "literal", "member-literal"],
      ]) {
        const finding = envelope.findings[index];
        assert.equal(finding.policy_id, policyId);
        assert.equal(finding.policyDefinitionReferenceId, reference);
        assert.equal(finding.required_value, "[parameters('tagName')]");
        assert.deepEqual(finding.assignment_parameters, {
          initiativeTag,
          locations: explicit ? [] : ["swedencentral"],
          settings: { enabled: false, limit: 0 },
          effect: "Deny",
          tagName,
          enabled: false,
          limit: 0,
        });
      }
    },
  );
}

for (const mode of [undefined, "Default", "DoNotEnforce"]) {
  for (const initiative of [false, true]) {
    test(
      `enforcementMode ${mode ?? "absent"} preserves ${initiative ? "initiative" : "direct"} constraints`,
      powershellOptions,
      (context) => {
        const responses = routes();
        const effects = ["Deny", "Modify", "DeployIfNotExists"];
        const definitions = effects.map((effect) => {
          const policy = definition(`/providers/Microsoft.Authorization/policyDefinitions/${effect}`);
          policy.properties.policyRule.then.effect = effect;
          return policy;
        });
        const setId = `${managementGroupScope}/providers/Microsoft.Authorization/policySetDefinitions/modes`;
        responses[definitionsUrl].value = definitions;
        responses[setsUrl].value = [
          {
            id: setId,
            properties: {
              policyDefinitions: definitions.map((policy, index) => ({
                policyDefinitionId: policy.id,
                policyDefinitionReferenceId: `member-${index}`,
              })),
            },
          },
        ];
        responses[assignmentsUrl].value = (initiative ? [setId] : definitions.map((policy) => policy.id)).map(
          (policyId, index) => {
            const assigned = assignment(policyId, managementGroupScope, `mode-${index}`);
            if (mode !== undefined) assigned.properties.enforcementMode = mode;
            return assigned;
          },
        );
        const envelope = assertComplete(collect(context, responses)).subscriptions[subscriptionId];
        assert.ok(envelope.assignment_inventory.every((item) => item.enforcementMode === (mode ?? "Default")));
        assert.deepEqual(
          envelope.findings.map((item) => [item.effect, item.classification, item.enforcementMode]),
          [
            ["deny", "blocker", mode ?? "Default"],
            ["modify", "auto-remediate", mode ?? "Default"],
            ["deployIfNotExists", "auto-remediate", mode ?? "Default"],
          ],
        );
        assert.deepEqual(envelope.policies, envelope.findings);
        assert.equal(envelope.discovery_summary.blocker_count, 1);
        assert.equal(envelope.discovery_summary.auto_remediate_count, 2);
        assert.equal(envelope.discovery_summary.disabled_count, 0);
        assert.equal(envelope.discovery_summary.audit_count, 0);
      },
    );
  }
}

for (const mode of [
  "Enroll",
  "unknown",
  "default",
  "donotenforce",
  "Default ",
  "",
  null,
  false,
  0,
  [],
  ["Default"],
  {},
]) {
  test(`enforcementMode rejects ${JSON.stringify(mode)} before publication`, powershellOptions, (context) => {
    const responses = routes();
    const policyId = "/providers/Microsoft.Authorization/policyDefinitions/mode";
    const assigned = assignment(policyId);
    assigned.properties.enforcementMode = mode;
    responses[assignmentsUrl].value = [assigned];
    responses[definitionsUrl].value = [definition(policyId)];
    assertAborted(collect(context, responses), /Unsupported assignment enforcementMode/);
  });
}

for (const mode of ["Default", "DoNotEnforce", "Enroll", null]) {
  test(
    `enforcementMode ${JSON.stringify(mode)} is validated before Defender filtering`,
    powershellOptions,
    (context) => {
      const responses = routes();
      const assigned = assignment("/providers/Microsoft.Authorization/policyDefinitions/defender");
      assigned.properties.enforcementMode = mode;
      assigned.properties.metadata = { assignedBy: "Microsoft Defender for Cloud" };
      responses[assignmentsUrl].value = [assigned];
      const result = collect(context, responses);
      if (mode === "Enroll" || mode === null) {
        assertAborted(result, /Unsupported assignment enforcementMode/);
      } else {
        const envelope = assertComplete(result).subscriptions[subscriptionId];
        assert.equal(envelope.discovery_summary.defender_auto_filtered, 1);
        assert.deepEqual(envelope.assignment_inventory, []);
        assert.deepEqual(envelope.findings, []);
      }
    },
  );
}

for (const root of [{ ManagementGroupId: "test-root" }, { SubscriptionId: subscriptionId }]) {
  test(`consumer collection retains Defender constraints for ${Object.keys(root)[0]}`, powershellOptions, (context) => {
    const responses = routes();
    const policyId = "/providers/Microsoft.Authorization/policyDefinitions/defender";
    const assigned = assignment(policyId, subscriptionScope);
    assigned.properties.metadata = { assignedBy: "Microsoft Defender for Cloud" };
    responses[assignmentsUrl].value = [assigned];
    responses[definitionsUrl].value = [definition(policyId)];
    const envelope = assertComplete(collect(context, responses, { root: { ...root, IncludeDefenderAuto: true } }))
      .subscriptions[subscriptionId];
    assert.equal(envelope.discovery_summary.defender_auto_filtered, 0);
    assert.equal(envelope.assignment_inventory.length, 1);
    assert.equal(envelope.findings.length, 1);
    assert.equal(envelope.findings[0].assignment_id, assigned.id);
    assert.equal(envelope.findings[0].effect, "deny");
    assert.equal(envelope.findings[0].classification, "blocker");
  });
}

for (const version of ["1.2.3", "1.*.*", "*", "", null, false, {}, []]) {
  for (const initiative of [false, true]) {
    test(
      `definitionVersion rejects ${JSON.stringify(version)} on ${initiative ? "member" : "assignment"}`,
      powershellOptions,
      (context) => {
        const responses = routes();
        const policyId = "/providers/Microsoft.Authorization/policyDefinitions/versioned";
        const setId = `${managementGroupScope}/providers/Microsoft.Authorization/policySetDefinitions/versioned`;
        const assigned = assignment(initiative ? setId : policyId);
        if (!initiative) assigned.properties.definitionVersion = version;
        responses[assignmentsUrl].value = [assigned];
        responses[definitionsUrl].value = [definition(policyId)];
        responses[setsUrl].value = [
          {
            id: setId,
            properties: {
              policyDefinitions: [
                { policyDefinitionId: policyId, policyDefinitionReferenceId: "versioned", definitionVersion: version },
              ],
            },
          },
        ];
        assertAborted(collect(context, responses), /Unsupported (assignment|initiative member) definitionVersion/);
      },
    );
  }
}

test("enforcementMode does not reintroduce whole-scope excluded assignments", powershellOptions, (context) => {
  const responses = routes();
  const assigned = assignment("/providers/Microsoft.Authorization/policyDefinitions/excluded");
  assigned.properties.notScopes = [subscriptionScope];
  assigned.properties.enforcementMode = "Enroll";
  responses[assignmentsUrl].value = [assigned];
  const envelope = assertComplete(collect(context, responses)).subscriptions[subscriptionId];
  assert.equal(envelope.discovery_summary.not_scope_excluded, 1);
  assert.deepEqual(envelope.assignment_inventory, []);
  assert.deepEqual(envelope.findings, []);
});

test("direct policy parameter defaults retain explicit assignment values", powershellOptions, (context) => {
  const responses = routes();
  const policyId = `${managementGroupScope}/providers/Microsoft.Authorization/policyDefinitions/parameters`;
  const policy = definition(policyId);
  policy.properties.parameters = {
    tagName: { type: "String", defaultValue: "policy-default" },
    enabled: { type: "Boolean", defaultValue: true },
    limit: { type: "Integer", defaultValue: 10 },
    locations: { type: "Array", defaultValue: ["swedencentral"] },
  };
  const assigned = assignment(policyId);
  assigned.properties.parameters = { enabled: { value: false }, limit: { value: 0 }, locations: { value: [] } };
  responses[assignmentsUrl].value = [assigned];
  responses[definitionsUrl].value = [policy];
  const [finding] = assertComplete(collect(context, responses)).subscriptions[subscriptionId].findings;
  assert.equal(Object.hasOwn(finding, "policyDefinitionReferenceId"), false);
  assert.deepEqual(finding.assignment_parameters, {
    tagName: "policy-default",
    enabled: false,
    limit: 0,
    locations: [],
  });
});

test("zero descendants produces a schema-compatible empty baseline", powershellOptions, (context) => {
  const responses = routes();
  responses[descendantsUrl].value = [];
  const baseline = assertComplete(collect(context, responses));
  assert.equal(baseline.subscriptions_discovered, 0);
  assert.equal(baseline.subscriptions_processed, 0);
});

test("cap preserves PARTIAL coverage and lists skipped subscriptions", powershellOptions, (context) => {
  const responses = routes();
  const secondId = "22222222-2222-2222-2222-222222222222";
  responses[descendantsUrl].value.push({ name: secondId, type: "Microsoft.Management/managementGroups/subscriptions" });
  responses[`${arm}/subscriptions/${secondId}?api-version=2022-12-01`] = { state: "Enabled" };
  const result = collect(context, responses, { cap: 1 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const baseline = JSON.parse(result.baseline);
  assert.equal(validateBaseline(baseline), true, JSON.stringify(validateBaseline.errors));
  assert.equal(baseline.coverage_status, "PARTIAL");
  assert.equal(baseline.subscriptions_processed, 1);
  assert.deepEqual(baseline.subscriptions_skipped, [secondId]);
});

for (const options of [{ cap: 0 }, { cap: -1 }, { token: {} }, { tokenExit: 1 }]) {
  test(`invalid collection input ${JSON.stringify(options)} fails closed`, powershellOptions, (context) => {
    assertAborted(collect(context, routes(), options), options.cap !== undefined ? /MaxSubscriptions/ : /token/i);
  });
}

test("a later subscription failure does not publish earlier completed subscriptions", powershellOptions, (context) => {
  const responses = routes();
  const secondId = "22222222-2222-2222-2222-222222222222";
  responses[descendantsUrl].value.push({ name: secondId, type: "Microsoft.Management/managementGroups/subscriptions" });
  responses[`${arm}/subscriptions/${secondId}?api-version=2022-12-01`] = { state: "Enabled" };
  responses[assignmentsUrl.replace(subscriptionId, secondId)] = { failure: "offline later subscription failure" };
  const result = collect(context, responses);
  assertAborted(result, /offline later subscription failure/);
  assert.match(result.stdout, /Processing subscription 2\/2/);
});

test("cached definitions and initiative members require no individual fetch", powershellOptions, (context) => {
  const responses = routes();
  const policyId = `${managementGroupScope}/providers/Microsoft.Authorization/policyDefinitions/cached-deny`;
  const setId = `${managementGroupScope}/providers/Microsoft.Authorization/policySetDefinitions/cached-set`;
  responses[assignmentsUrl].value = [assignment(policyId), assignment(setId, subscriptionScope, "direct")];
  responses[definitionsUrl].value = [definition(policyId)];
  responses[setsUrl].value = [
    {
      id: setId,
      properties: {
        policyDefinitions: [{ policyDefinitionId: policyId, policyDefinitionReferenceId: "cached-member" }],
      },
    },
  ];
  const baseline = assertComplete(collect(context, responses));
  assert.equal(baseline.subscriptions[subscriptionId].findings.length, 2);
});

for (const scenario of [
  {
    name: "direct assignment overrides disabled default",
    defaultEffect: "Disabled",
    assigned: "Deny",
    expected: "blocker",
  },
  { name: "direct assignment disables deny default", assigned: "Disabled", disabled: 1 },
  { name: "direct assignment audits deny default", assigned: "Audit", audit: 1 },
  { name: "direct assignment append remains omitted", assigned: "Append", other: 1 },
  { name: "direct assignment manual remains omitted", assigned: "Manual", other: 1 },
  { name: "direct assignment deny action remains omitted", assigned: "DenyAction", other: 1 },
  { name: "direct assignment mutate remains omitted", assigned: "Mutate", other: 1 },
  { name: "direct definition default", expected: "blocker" },
  {
    name: "initiative assignment overrides both defaults",
    initiative: true,
    assigned: "Modify",
    expected: "auto-remediate",
  },
  { name: "initiative default overrides policy default", initiative: true, disabled: 1 },
  { name: "initiative literal binding", initiative: true, literal: "Deny", expected: "blocker" },
  { name: "initiative unbound member uses policy default", initiative: true, unbound: true, expected: "blocker" },
  { name: "missing effect value", assigned: null, failure: /Unresolved or unsupported policy effect/ },
  {
    name: "unsupported effect expression",
    assigned: "[concat('De', 'ny')]",
    failure: /Unresolved or unsupported policy effect/,
  },
  {
    name: "missing initiative value",
    initiative: true,
    assigned: null,
    failure: /Unresolved or unsupported policy effect/,
  },
  {
    name: "assignment effect override",
    assigned: "Disabled",
    overrides: [{ kind: "policyEffect", value: "Deny" }],
    expected: "blocker",
  },
  {
    name: "member override matches",
    initiative: true,
    overrides: [
      { kind: "policyEffect", value: "Deny", selectors: [{ kind: "policyDefinitionReferenceId", in: ["member"] }] },
    ],
    expected: "blocker",
  },
  {
    name: "member override does not match",
    initiative: true,
    overrides: [
      { kind: "policyEffect", value: "Deny", selectors: [{ kind: "policyDefinitionReferenceId", in: ["other"] }] },
    ],
    disabled: 1,
  },
  {
    name: "member override notIn excludes",
    initiative: true,
    overrides: [
      { kind: "policyEffect", value: "Deny", selectors: [{ kind: "policyDefinitionReferenceId", notIn: ["member"] }] },
    ],
    disabled: 1,
  },
  {
    name: "unsupported override selector",
    initiative: true,
    overrides: [
      { kind: "policyEffect", value: "Deny", selectors: [{ kind: "resourceLocation", in: ["swedencentral"] }] },
    ],
    failure: /Unsupported policy effect override selector/,
  },
  {
    name: "overlapping overrides",
    overrides: [
      { kind: "policyEffect", value: "Deny" },
      { kind: "policyEffect", value: "Disabled" },
    ],
    failure: /Overlapping policy effect overrides/,
  },
  {
    name: "malformed overrides",
    overrides: { kind: "policyEffect", value: "Disabled" },
    failure: /Invalid assignment overrides/,
  },
  {
    name: "unsupported override kind",
    overrides: [{ kind: "policyVersion", value: "1.0.0" }],
    failure: /Unsupported assignment override kind/,
  },
  {
    name: "malformed override selectors",
    overrides: [{ kind: "policyEffect", value: "Deny", selectors: {} }],
    failure: /Invalid policy effect override selectors/,
  },
]) {
  test(`effective policy: ${scenario.name}`, powershellOptions, (context) => {
    const responses = routes();
    const policyId = `${managementGroupScope}/providers/Microsoft.Authorization/policyDefinitions/effect`;
    const setId = `${managementGroupScope}/providers/Microsoft.Authorization/policySetDefinitions/effect`;
    const policy = definition(policyId);
    policy.properties.policyRule.then.effect = "[parameters('effect')]";
    policy.properties.parameters = { effect: { type: "String", defaultValue: scenario.defaultEffect ?? "Deny" } };
    const assigned = assignment(scenario.initiative ? setId : policyId);
    if (Object.hasOwn(scenario, "assigned")) {
      assigned.properties.parameters = {
        [scenario.initiative ? "initiativeEffect" : "effect"]: { value: scenario.assigned },
      };
    }
    if (scenario.overrides) assigned.properties.overrides = scenario.overrides;
    responses[assignmentsUrl].value = [assigned];
    responses[definitionsUrl].value = [policy];
    if (scenario.initiative) {
      responses[setsUrl].value = [
        {
          id: setId,
          properties: {
            parameters: { initiativeEffect: { type: "String", defaultValue: "Disabled" } },
            policyDefinitions: [
              {
                policyDefinitionId: policyId,
                policyDefinitionReferenceId: "member",
                ...(scenario.unbound
                  ? {}
                  : { parameters: { effect: { value: scenario.literal ?? "[parameters('initiativeEffect')]" } } }),
              },
            ],
          },
        },
      ];
    }
    const result = collect(context, responses, { root: { SubscriptionId: subscriptionId } });
    if (scenario.failure) {
      assertAborted(result, scenario.failure);
      return;
    }
    const envelope = assertComplete(result).subscriptions[subscriptionId];
    assert.equal(envelope.discovery_summary.disabled_count, scenario.disabled ?? 0);
    assert.equal(envelope.discovery_summary.audit_count, scenario.audit ?? 0);
    assert.equal(envelope.discovery_summary.other_effect_count, scenario.other ?? 0);
    assert.equal(envelope.discovery_summary.classified_policy_count, 1);
    assert.equal(envelope.findings.length, scenario.expected ? 1 : 0);
    if (scenario.expected) {
      const finding = envelope.findings[0];
      assert.equal(finding.classification, scenario.expected);
      assert.equal(finding.assignment_id, assigned.id);
      assert.equal(finding.scope, managementGroupScope);
      assert.deepEqual(finding.override, scenario.overrides?.[0] ?? null);
      if (Object.hasOwn(scenario, "assigned")) {
        assert.equal(
          finding.assignment_parameters[scenario.initiative ? "initiativeEffect" : "effect"],
          scenario.assigned,
        );
      }
    }
  });
}

for (const scenario of [
  { name: "whole subscription exclusion", notScopes: [`${subscriptionScope.toUpperCase()}/`], excluded: true },
  { name: "assignment scope exclusion", notScopes: [managementGroupScope], excluded: true },
  {
    name: "other subscription exclusion",
    notScopes: ["/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/other"],
  },
  {
    name: "partial subscription exclusion",
    notScopes: [`${subscriptionScope}/resourceGroups/partial`],
    failure: /Partial subscription notScopes/,
  },
  {
    name: "unknown MG exclusion",
    notScopes: ["/providers/Microsoft.Management/managementGroups/unknown"],
    failure: /Unresolved management group notScopes/,
  },
  { name: "malformed exclusions", notScopes: subscriptionScope, failure: /Invalid assignment notScopes/ },
  { name: "malformed exclusion entry", notScopes: [null], failure: /Invalid assignment notScopes entry/ },
  {
    name: "selective assignment",
    resourceSelectors: [{ selectors: [{ kind: "resourceLocation", in: ["swedencentral"] }] }],
    failure: /Unsupported assignment resourceSelectors/,
  },
]) {
  test(`effective scope: ${scenario.name}`, powershellOptions, (context) => {
    const responses = routes();
    const policyId = `${managementGroupScope}/providers/Microsoft.Authorization/policyDefinitions/scope`;
    const assigned = assignment(policyId);
    assigned.properties.notScopes = scenario.notScopes ?? [];
    if (scenario.resourceSelectors) assigned.properties.resourceSelectors = scenario.resourceSelectors;
    responses[assignmentsUrl].value = [assigned];
    responses[definitionsUrl].value = [definition(policyId)];
    const result = collect(context, responses, { root: { SubscriptionId: subscriptionId } });
    if (scenario.failure) {
      assertAborted(result, scenario.failure);
      return;
    }
    const envelope = assertComplete(result).subscriptions[subscriptionId];
    assert.equal(envelope.discovery_summary.assignment_total, 1);
    assert.equal(envelope.discovery_summary.assignment_kept, scenario.excluded ? 0 : 1);
    assert.equal(envelope.discovery_summary.not_scope_excluded, scenario.excluded ? 1 : 0);
    assert.equal(envelope.findings.length, scenario.excluded ? 0 : 1);
  });
}

for (const suffix of ["", "name/child", "name?query", "name#fragment", "white space"]) {
  test(`exemption rejects malformed assignment identity ${JSON.stringify(suffix)}`, powershellOptions, (context) => {
    const responses = routes();
    responses[exemptionsUrl].value = [
      {
        id: `${subscriptionScope}/providers/Microsoft.Authorization/policyExemptions/waiver`,
        properties: {
          policyAssignmentId: `${subscriptionScope}/providers/Microsoft.Authorization/policyAssignments/${suffix}`,
          exemptionCategory: "Waiver",
        },
      },
    ];
    assertAborted(collect(context, responses), /Invalid policy exemption assignment identity/);
  });
}

for (const scenario of [
  { name: "expired waiver", expiresOn: "2000-01-01T00:00:00Z", expired: true },
  { name: "active waiver", expiresOn: "2999-01-01T00:00:00Z" },
  { name: "permanent waiver" },
  {
    name: "management group waiver",
    id: `${managementGroupScope}/providers/Microsoft.Authorization/policyExemptions/waiver`,
    scope: managementGroupScope,
  },
  {
    name: "unrelated management group waiver",
    id: "/providers/Microsoft.Management/managementGroups/unrelated/providers/Microsoft.Authorization/policyExemptions/waiver",
    failure: /Policy exemption scope does not cover/,
  },
  {
    name: "query in exemption identity",
    id: `${subscriptionScope}/providers/Microsoft.Authorization/policyExemptions/waiver?scope=other`,
    failure: /Invalid or unsupported policy exemption scope/,
  },
  { name: "missing identity", id: null, failure: /Invalid or unsupported policy exemption scope/ },
  {
    name: "child scope cannot waive subscription",
    id: `${subscriptionScope}/resourceGroups/child/providers/Microsoft.Authorization/policyExemptions/waiver`,
    failure: /Invalid or unsupported policy exemption scope/,
  },
  {
    name: "foreign scope",
    id: "/subscriptions/22222222-2222-2222-2222-222222222222/providers/Microsoft.Authorization/policyExemptions/waiver",
    failure: /Policy exemption scope does not cover/,
  },
  { name: "invalid expiration", expiresOn: "not-a-date", failure: /Invalid policy exemption expiresOn/ },
  {
    name: "expiration without timezone",
    expiresOn: "2999-01-01T00:00:00",
    failure: /Invalid policy exemption expiresOn/,
  },
  {
    name: "selective exemption",
    resourceSelectors: [{ selectors: [{ kind: "resourceLocation", in: ["swedencentral"] }] }],
    failure: /Unsupported policy exemption resourceSelectors/,
  },
  { name: "malformed member references", refs: "member", failure: /Invalid policy exemption member references/ },
  { name: "multiple member exemptions", multiple: true },
  { name: "expired exemption cannot overwrite active waiver", multiple: true, expiredLast: true },
  { name: "expired remediation waiver", effect: "Modify", expiresOn: "2000-01-01T00:00:00Z", expired: true },
  { name: "active remediation waiver", effect: "Modify" },
]) {
  test(`effective exemption: ${scenario.name}`, powershellOptions, (context) => {
    const responses = routes();
    const policyId = `${managementGroupScope}/providers/Microsoft.Authorization/policyDefinitions/exempt`;
    const setId = `${managementGroupScope}/providers/Microsoft.Authorization/policySetDefinitions/exempt`;
    const assigned = assignment(scenario.multiple ? setId : policyId);
    const policy = definition(policyId);
    policy.properties.policyRule.then.effect = scenario.effect ?? "Deny";
    responses[assignmentsUrl].value = [assigned];
    responses[definitionsUrl].value = [policy];
    const exemption = {
      id: Object.hasOwn(scenario, "id")
        ? scenario.id
        : `${subscriptionScope}/providers/Microsoft.Authorization/policyExemptions/waiver`,
      properties: {
        policyAssignmentId: assigned.id,
        exemptionCategory: "Waiver",
        ...(scenario.expiresOn ? { expiresOn: scenario.expiresOn } : {}),
        ...(scenario.resourceSelectors ? { resourceSelectors: scenario.resourceSelectors } : {}),
        ...(scenario.refs ? { policyDefinitionReferenceIds: scenario.refs } : {}),
      },
    };
    responses[exemptionsUrl].value = [exemption];
    if (scenario.multiple) {
      responses[setsUrl].value = [
        {
          id: setId,
          properties: {
            policyDefinitions: ["first", "second"].map((reference) => ({
              policyDefinitionId: policyId,
              policyDefinitionReferenceId: reference,
            })),
          },
        },
      ];
      responses[exemptionsUrl].value = ["first", "second"].map((reference) => ({
        id: `${exemption.id}-${reference}`,
        properties: { ...exemption.properties, policyDefinitionReferenceIds: [reference] },
      }));
      if (scenario.expiredLast)
        responses[exemptionsUrl].value.push({
          id: `${exemption.id}-expired`,
          properties: { ...exemption.properties, expiresOn: "2000-01-01T00:00:00Z" },
        });
    }
    const result = collect(context, responses, { root: { SubscriptionId: subscriptionId } });
    if (scenario.failure) {
      assertAborted(result, scenario.failure);
      return;
    }
    const envelope = assertComplete(result).subscriptions[subscriptionId];
    const count = scenario.multiple ? 2 : 1;
    assert.equal(envelope.findings.length, count);
    assert.equal(envelope.discovery_summary.expired_exemption_count, scenario.expired || scenario.expiredLast ? 1 : 0);
    assert.equal(envelope.discovery_summary.exempted_count, scenario.expired ? 0 : count);
    for (const finding of envelope.findings) {
      assert.equal(
        finding.classification,
        scenario.expired ? (scenario.effect === "Modify" ? "auto-remediate" : "blocker") : "informational",
      );
      assert.equal(finding.exemption === null, Boolean(scenario.expired));
      if (finding.exemption) {
        assert.equal(finding.exemption.scope, scenario.scope ?? subscriptionScope);
        assert.ok(
          finding.exemption.id.startsWith(
            `${scenario.scope ?? subscriptionScope}/providers/Microsoft.Authorization/policyExemptions/`,
          ),
        );
        assert.equal(finding.exemption.expiresOn, scenario.expiresOn ?? null);
      }
    }
  });
}
