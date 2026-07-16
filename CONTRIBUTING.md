# Contributing to APEX vNext

Thanks for your interest in contributing!

APEX vNext development happens in this repository. Start from an issue, use a
conventional branch and commit, and keep pull requests focused on one
dependency-complete change.

## Quick links

| Resource           | Link                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| User guides        | [Documentation](docs/README.md)                                          |
| Project controls   | [vNext project hub](docs/vnext/README.md)                                |
| Open issues        | Use the repository's **Issues** tab                                     |
| Source provenance  | [Migration record](docs/MIGRATION.md)                                    |

## Validate Changes

Run focused checks while editing, then the complete qualification lane before
opening a pull request:

```bash
npm ci
npm run qualify:vnext
npm run validate:all
```

## License

By contributing, you agree that your contributions will be licensed under
the [MIT License](LICENSE).
