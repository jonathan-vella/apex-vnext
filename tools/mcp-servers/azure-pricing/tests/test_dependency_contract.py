"""Dependency compatibility contract tests."""

import tomllib
from pathlib import Path

PROJECT_FILE = Path(__file__).parents[1] / "pyproject.toml"


def test_python_mcp_sdk_stays_on_supported_v1_api() -> None:
    project = tomllib.loads(PROJECT_FILE.read_text(encoding="utf-8"))["project"]
    mcp_requirement = next(value for value in project["dependencies"] if value.startswith("mcp"))

    assert mcp_requirement == "mcp>=1.27.0,<2"
