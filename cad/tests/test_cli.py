"""The M0 console entry: it parses, and then it refuses (AC-03)."""

from __future__ import annotations

import pytest

from vextrus_cad.cli import EXIT_REFUSED, main


@pytest.mark.parametrize("subcommand", ["ingest", "validate"])
def test_a_well_formed_call_refuses_by_name(
    subcommand: str, capsys: pytest.CaptureFixture[str]
) -> None:
    status = main([subcommand, "some.dxf"])

    assert status == EXIT_REFUSED
    assert capsys.readouterr().out == f"NOT_IMPLEMENTED_UNTIL_M1 {subcommand}\n"


@pytest.mark.parametrize("argv", [[], ["ingest"], ["bogus"], ["bogus", "some.dxf"]])
def test_a_malformed_call_is_a_usage_error(
    argv: list[str], capsys: pytest.CaptureFixture[str]
) -> None:
    # Usage errors are argparse's exit 2, and they never print the refusal:
    # "I cannot do this yet" and "you asked wrongly" are different answers.
    with pytest.raises(SystemExit) as raised:
        main(argv)

    assert raised.value.code == 2
    captured = capsys.readouterr()
    assert "NOT_IMPLEMENTED_UNTIL_M1" not in captured.out + captured.err
    assert captured.err.strip() != ""
