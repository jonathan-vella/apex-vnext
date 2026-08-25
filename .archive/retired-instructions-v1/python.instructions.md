---
description: "Python coding conventions for vNext validation, governance discovery, and repository tooling"
applyTo: "**/*.py"
---

# Python Guidelines

Instructions for writing clean, consistent Python in this repository. Target Python 3.14
(latest stable) with Ruff for linting and formatting.

## Project Context

Python is used for two active purposes in this repo:

1. **Governance discovery** — policy discovery and deterministic contract rendering
2. **Repository tooling** — `apex-recall`, profiling, and Python tests

## Style & Formatting

- **Formatter**: Ruff (`ruff format`) — double quotes, space indentation
- **Linter**: Ruff with rules: E, W, F, I, B, C4, UP, SIM
- **Line length**: 120 characters (matches project-wide setting)
- **Imports**: sorted by isort rules via Ruff — stdlib, third-party, first-party
- **Quotes**: double quotes for strings
- **Type hints**: use for function signatures; `pyproject.toml` sets `basic` type checking

## Package Management

- Use `uv` (Astral) as the package manager — installed in devcontainer
- Package-specific dependencies live with their owning Python tool.
- Keep repository test dependencies in the deterministic devcontainer bootstrap or an owning `pyproject.toml`.

## Conventions

- Use `snake_case` for functions, variables, and modules
- Use `PascalCase` for classes
- Use `UPPER_SNAKE_CASE` for constants
- Prefer f-strings over `.format()` or `%` formatting
- Use pathlib `Path` for new code — existing scripts may use `os.path`
- Use context managers (`with`) for file and network operations

## Testing

- Test framework: `pytest`
- Tests live alongside source in `tests/` subdirectories
- Use `@pytest.mark.asyncio` for async test functions
