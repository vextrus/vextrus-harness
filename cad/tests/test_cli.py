"""The M0 console entry refuses by name and tells usage errors apart (AC-03)."""

import pytest

from vextrus_cad.cli import EXIT_REFUSED, REFUSAL, main


@pytest.mark.parametrize("subcommand", ["ingest", "validate"])
def test_a_known_subcommand_refuses_with_its_own_name(
    subcommand: str, capsys: pytest.CaptureFixture[str]
) -> None:
    status = main([subcommand, "some.dxf"])

    assert status == EXIT_REFUSED
    assert capsys.readouterr().out == f"{REFUSAL} {subcommand}\n"


@pytest.mark.parametrize("argv", [[], ["ingest"], ["bogus"], ["bogus", "some.dxf"]])
def test_an_unusable_command_line_is_a_usage_error(
    argv: list[str], capsys: pytest.CaptureFixture[str]
) -> None:
    """Exit 2 with usage on stderr — and never the refusal line, which would read
    as "we understood you" to a caller who was in fact not understood."""
    with pytest.raises(SystemExit) as exit_info:
        main(argv)

    assert exit_info.value.code == 2
    captured = capsys.readouterr()
    assert captured.err.strip() != ""
    assert REFUSAL not in captured.out + captured.err
