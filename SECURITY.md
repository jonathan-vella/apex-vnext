# Security Policy

## Report A Vulnerability

Use GitHub private vulnerability reporting from the repository's **Security** tab. Include the affected commit or
version, impact, reproduction steps, and any suggested mitigation.

Do not disclose vulnerabilities, credentials, exploit details, or secret-bearing evidence in public issues, pull
requests, discussions, or workflow logs. If private vulnerability reporting is temporarily unavailable, open a public
issue requesting a private maintainer contact without including security details.

## Response Process

The repository maintainer will acknowledge a report, assess severity and affected release lines, coordinate a private
fix, and decide disclosure timing. Critical and high findings block publication and cutover until resolved or shown to
be unreachable in supported use.

Security fixes follow the independently reviewed backport and forward-port process in the
[v1 maintenance policy](docs/vnext/phase-0a/v1-maintenance-policy.md). Published package versions and consumed Git tags
are immutable; remediation uses a new version rather than rewriting released artifacts.

## Supported Versions

APEX vNext remains pre-cutover and has no published supported package release. The final support policy and v1 support
end date will be published only after explicit cutover authorization.
