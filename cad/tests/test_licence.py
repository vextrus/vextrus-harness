"""The Python-runtime half of the licence test (AC-04; L-CAD-04, D-04).

L-CAD-04 bans the AGPL PDF stack from shipped code and asks for the ban to be
enforced "on both runtimes". The Node half drives the verify stage's scanner over
a tampered `package.json`; this half is the same idea pointed at the file the
Python project is actually built from — and it has to be a thing that *fires*, so
each ban is proved against a pyproject that breaks it, fed the way the real
scanner is fed: through `VEXTRUS_CAD_PYPROJECT`.

D-04 is the asymmetry worth reading twice: reportlab is not banned, it is
*located*. It writes the vector-PDF fixtures, so it is legitimate in the
`fixtures` dependency group and a refusal anywhere else.
"""

import os
import tomllib
from pathlib import Path

import pytest

#: Names that may never appear as a dependency of this project (L-CAD-04).
BANNED_ANYWHERE = ("pymupdf", "fitz", "mutool")

#: Legitimate in exactly one place, refused everywhere else (D-04).
FIXTURES_ONLY = "reportlab"

#: The dependency group reportlab is allowed to live in.
FIXTURES_GROUP = "fixtures"

DEFAULT_PYPROJECT = Path(__file__).resolve().parent.parent / "pyproject.toml"


def target_pyproject() -> Path:
    """The pyproject under test: the override, else this project's own."""
    override = os.environ.get("VEXTRUS_CAD_PYPROJECT", "").strip()
    return Path(override) if override else DEFAULT_PYPROJECT


def requirement_name(requirement: str) -> str:
    """`ezdxf==1.4.4` / `Pillow[extra] >=1` -> `ezdxf` / `pillow`."""
    name = requirement.strip()
    for separator in ("[", "(", "<", ">", "=", "!", "~", ";", " ", "\t"):
        name = name.split(separator, 1)[0]
    return name.strip().lower().replace("_", "-")


def declared_dependencies(pyproject: Path) -> list[tuple[str, str]]:
    """Every declared requirement as `(name, where it was declared)`."""
    parsed = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    project = parsed.get("project", {})

    declarations: list[tuple[str, str]] = []
    for requirement in project.get("dependencies", []):
        declarations.append((requirement_name(requirement), "project.dependencies"))
    for extra, requirements in (project.get("optional-dependencies", {})).items():
        where = f"project.optional-dependencies.{extra}"
        for requirement in requirements:
            declarations.append((requirement_name(requirement), where))
    for group, requirements in (parsed.get("dependency-groups", {})).items():
        for requirement in requirements:
            declarations.append((requirement_name(requirement), f"dependency-groups.{group}"))
    return declarations


def scan(pyproject: Path) -> list[str]:
    """The refusal lines this pyproject earns — same wording as the Node scanner."""
    refusals = []
    for name, where in declared_dependencies(pyproject):
        banned = name in BANNED_ANYWHERE
        misplaced = name == FIXTURES_ONLY and where != f"dependency-groups.{FIXTURES_GROUP}"
        if banned or misplaced:
            refusals.append(f"BANNED_DEPENDENCY {name} in {pyproject}")
    return refusals


def write_pyproject(directory: Path, body: str) -> Path:
    """A minimal pyproject carrying `body`, where the scanner can be pointed at it."""
    path = directory / "pyproject.toml"
    path.write_text(
        '[project]\nname = "tampered"\nversion = "0.0.0"\n'
        'requires-python = ">=3.13,<3.14"\n' + body,
        encoding="utf-8",
    )
    return path


def test_the_committed_pyproject_is_clean() -> None:
    """The file this project is really built from names nothing banned."""
    assert scan(target_pyproject()) == []


@pytest.mark.parametrize("banned", BANNED_ANYWHERE)
def test_an_agpl_pdf_library_in_project_dependencies_is_refused(
    banned: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """L-CAD-04: the AGPL PDF stack is banned wherever it is declared."""
    tampered = write_pyproject(tmp_path, f'dependencies = ["{banned}==1.0.0"]\n')
    monkeypatch.setenv("VEXTRUS_CAD_PYPROJECT", str(tampered))

    refusals = scan(target_pyproject())

    assert refusals == [f"BANNED_DEPENDENCY {banned} in {tampered}"]


def test_reportlab_outside_the_fixtures_group_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D-04: reportlab is a fixtures tool, never an application dependency."""
    tampered = write_pyproject(tmp_path, f'dependencies = ["{FIXTURES_ONLY}==4.4.9"]\n')
    monkeypatch.setenv("VEXTRUS_CAD_PYPROJECT", str(tampered))

    assert scan(target_pyproject()) == [f"BANNED_DEPENDENCY {FIXTURES_ONLY} in {tampered}"]


def test_reportlab_in_the_fixtures_group_is_allowed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The negative half: the ban has to be about placement, not the name."""
    allowed = write_pyproject(
        tmp_path,
        f'\n[dependency-groups]\n{FIXTURES_GROUP} = ["{FIXTURES_ONLY}==4.4.9"]\n',
    )
    monkeypatch.setenv("VEXTRUS_CAD_PYPROJECT", str(allowed))

    assert scan(target_pyproject()) == []


def test_reportlab_in_another_dependency_group_is_still_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`dev` is not `fixtures`: the group is the whole permission (D-04)."""
    tampered = write_pyproject(
        tmp_path,
        f'\n[dependency-groups]\ndev = ["{FIXTURES_ONLY}==4.4.9"]\n',
    )
    monkeypatch.setenv("VEXTRUS_CAD_PYPROJECT", str(tampered))

    assert scan(target_pyproject()) == [f"BANNED_DEPENDENCY {FIXTURES_ONLY} in {tampered}"]


def test_the_fixtures_group_pins_reportlab_exactly() -> None:
    """D-04 records the writer; a pin is what makes the fixtures reproducible."""
    parsed = tomllib.loads(target_pyproject().read_text(encoding="utf-8"))
    fixtures = parsed.get("dependency-groups", {}).get(FIXTURES_GROUP, [])

    assert any(requirement.lower().startswith(f"{FIXTURES_ONLY}==") for requirement in fixtures)
