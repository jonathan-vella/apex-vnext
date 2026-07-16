import assert from "node:assert/strict";
import test from "node:test";
import { securityExceptionId, securityExceptionIssues } from "../scripts/_lib/security-exceptions.mjs";

const exception = {
  id: "sandbox-runner-ip",
  control: "public-network-access",
  requested_at: "2026-07-15T12:00:00.000Z",
  expires_at: "2026-07-16T12:00:00.000Z",
  reason: "Allow one ephemeral runner address for a bounded qualification.",
  issue_link: "https://github.com/jonathan-vella/apex/issues/543",
  compensating_controls: ["Default-deny firewall"],
};

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

test("security exception annotation is line-local and bounded", () => {
  assert.equal(
    securityExceptionId("publicNetworkAccess: 'Enabled' // apex-security-exception: sandbox-runner-ip"),
    "sandbox-runner-ip",
  );
  assert.equal(securityExceptionId("// apex-security-exception: sandbox-runner-ip trailing"), undefined);
});
