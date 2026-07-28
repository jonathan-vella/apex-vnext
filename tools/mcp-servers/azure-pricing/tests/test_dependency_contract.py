"""Dependency compatibility contract tests."""

import tomllib
from pathlib import Path

from packaging.requirements import Requirement
from packaging.version import Version

PROJECT_FILE = Path(__file__).parents[1] / "pyproject.toml"


def test_python_mcp_sdk_stays_on_supported_v1_api() -> None:
    project = tomllib.loads(PROJECT_FILE.read_text(encoding="utf-8"))["project"]
    requirements = [Requirement(value) for value in project["dependencies"]]
    mcp_requirement = next(requirement for requirement in requirements if requirement.name == "mcp")

    assert Version("1.27.0") in mcp_requirement.specifier
    assert Version("1.29.0") in mcp_requirement.specifier
    assert Version("2.0.0") not in mcp_requirement.specifier
