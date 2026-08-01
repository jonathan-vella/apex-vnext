# Contributing to APEX vNext

Thanks for your interest in contributing!

APEX vNext development happens in this repository. Start from an issue, use a
conventional branch and commit, and keep pull requests focused on one
dependency-complete change.

## Quick links

| Resource           | Link                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| User guides        | [Documentation](docs/README.md)                                          |
| Contributor guide  | [Contribute to APEX vNext](docs/how-to/contribute.md)                    |
| Project controls   | [vNext project hub](docs/vnext/README.md)                                |
| Open issues        | Use the repository's **Issues** tab                                     |
| Source provenance  | [Migration record](docs/MIGRATION.md)                                    |
| Security reports   | [Private vulnerability reporting](SECURITY.md)                           |

## Validate Changes

Run focused checks while editing, then the complete qualification lane before
opening a pull request:

```bash
npm ci
npm run qualify:vnext
npm run validate:all
```

The [contributor guide](docs/how-to/contribute.md) explains package boundaries, source ownership, focused checks, and
release authority.

Report vulnerabilities through the confidential process in [SECURITY.md](SECURITY.md), never through a public issue or
pull request.

## License

By contributing, you agree that your contributions will be licensed under
the [MIT License](LICENSE).
