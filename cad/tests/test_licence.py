"""The Python-runtime half of the licence test (L-CAD-04, D-04).

L-CAD-04 bans the AGPL PDF libraries from shipped code "and a licence test
enforces it on both runtimes". This is the Python runtime's half; the Node half
drives the same ban over `package.json` from `tests/scripts/licence-ban.test.ts`.

The test reads a pyproject rather than the installed environment on purpose: the
declaration is what a reviewer and a release both go by, and it is the thing a
future increment would edit. `VEXTRUS_CAD_PYPROJECT` names which file to read so
the same scanner can be pointed at a tampered copy — a ban nobody has ever seen
fire is a comment, not a test.
"""

from __future__ import annotations

import os
import tomllib
from pathlib import Path

import pytest

#: Banned outright: AGPL PDF libraries have no place in shipped code (L-CAD-04).
BANNED = ("pymupdf", "fitz", "mutool")

#: D-04: permissive, BSD, and allowed for fixture generation — nowhere else.
FIXTURES_ONLY = "reportlab"

#: The one dependency group `FIXTURES_ONLY` may be declared in.
FIXTURES_GROUP = "fixtures"

REPO_PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def requirement_name(requirement: str) -> str:
    """`ezdxf==1.4.4` -> `ezdxf`; PEP 503 normalised and case-folded."""
    name = requirement.strip()
    for index, character in enumerate(name):
        if character in "[<>=!~; ":
            name = name[:index]
            break
    return name.strip().lower().replace("_", "-").replace(".", "-")


def declared(pyproject: Path) -> list[tuple[str, str]]:
    """Every dependency the file declares, as (normalised name, where)."""
    data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    project = data.get("project", {})
    found: list[tuple[str, str]] = [
        (requirement_name(entry), "[project.dependencies]")
        for entry in project.get("dependencies", [])
    ]
    for extra, entries in project.get("optional-dependencies", {}).items():
        where = f"[project.optional-dependencies] {extra}"
        found += [(requirement_name(entry), where) for entry in entries]
    for group, entries in data.get("dependency-groups", {}).items():
        found += [(requirement_name(e), f"[dependency-groups] {group}") for e in entries]
    found += [
        (requirement_name(entry), "[build-system.requires]")
        for entry in data.get("build-system", {}).get("requires", [])
    ]
    return found


def offences(pyproject: Path) -> list[str]:
    """`BANNED_DEPENDENCY <name> in <file>` for every refusal the file earns."""
    lines = []
    for name, where in declared(pyproject):
        if name in BANNED:
            lines.append(f"BANNED_DEPENDENCY {name} in {pyproject} ({where})")
        elif name == FIXTURES_ONLY and where != f"[dependency-groups] {FIXTURES_GROUP}":
            lines.append(f"BANNED_DEPENDENCY {name} in {pyproject} ({where})")
    return lines


def pyproject_under_test() -> Path:
    """The file to scan: whatever `VEXTRUS_CAD_PYPROJECT` names, else this project's."""
    override = os.environ.get("VEXTRUS_CAD_PYPROJECT", "").strip()
    return Path(override) if override else REPO_PYPROJECT


def write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "pyproject.toml"
    path.write_text(body, encoding="utf-8")
    return path


def test_the_pyproject_under_test_declares_nothing_banned() -> None:
    assert offences(pyproject_under_test()) == []


def test_the_banned_names_appear_nowhere_in_the_project_file() -> None:
    # Not just undeclared: L-CAD-04 bans them from shipped code, and a commented
    # out dependency is a dependency somebody will uncomment.
    text = REPO_PYPROJECT.read_text(encoding="utf-8").lower()
    for banned in BANNED:
        assert banned not in text


def test_the_permissive_readers_are_pinned_exactly() -> None:
    # L-CAD-04: DXF via ezdxf (MIT), PDF via pypdfium2 (permissive).
    data = tomllib.loads(REPO_PYPROJECT.read_text(encoding="utf-8"))
    dependencies = data["project"]["dependencies"]
    for name in ("ezdxf", "pypdfium2", "numpy", "opencv-python-headless"):
        pin = next((d for d in dependencies if requirement_name(d) == name), None)
        assert pin is not None, f"{name} must be declared"
        assert "==" in pin, f"{name} must be pinned exactly, got {pin}"


def test_the_fixtures_writer_is_pinned_in_its_group_only() -> None:
    # D-04: acceptable in fixtures generation only, never in the app.
    data = tomllib.loads(REPO_PYPROJECT.read_text(encoding="utf-8"))
    group = data["dependency-groups"][FIXTURES_GROUP]
    dependencies = data["project"]["dependencies"]
    assert any(requirement_name(entry) == FIXTURES_ONLY for entry in group)
    assert all(requirement_name(entry) != FIXTURES_ONLY for entry in dependencies)


@pytest.mark.parametrize("banned", BANNED)
def test_a_banned_reader_in_the_dependencies_is_refused(tmp_path: Path, banned: str) -> None:
    tampered = write(
        tmp_path,
        f'[project]\nname = "t"\nversion = "0"\ndependencies = ["{banned}==1.0"]\n',
    )

    assert offences(tampered) == [
        f"BANNED_DEPENDENCY {banned} in {tampered} ([project.dependencies])"
    ]


def test_the_fixtures_writer_outside_its_group_is_refused(tmp_path: Path) -> None:
    tampered = write(
        tmp_path,
        f'[project]\nname = "t"\nversion = "0"\ndependencies = ["{FIXTURES_ONLY}==4.0"]\n',
    )

    assert offences(tampered) == [
        f"BANNED_DEPENDENCY {FIXTURES_ONLY} in {tampered} ([project.dependencies])"
    ]


def test_the_fixtures_writer_inside_its_group_is_allowed(tmp_path: Path) -> None:
    clean = write(
        tmp_path,
        f'[dependency-groups]\n{FIXTURES_GROUP} = ["{FIXTURES_ONLY}==4.0"]\n',
    )

    assert offences(clean) == []
