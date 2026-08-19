"""The `vextrus-cad` console entry.

M0 has no ingestion. What it does have is the shape of one: the two subcommands
this lane will grow — `ingest` and `validate` — exist, take the drawing they will
one day read, and refuse loudly by name.

The two failure modes are deliberately different exit codes, because they are
different facts about the caller. A command that was *understood* and declined is
a refusal (exit 3, the refusal line on stdout); a command that was never
understood is a usage error (exit 2, argparse's usage on stderr, and no refusal
line at all — a caller must never be able to read "not implemented" out of a
typo).
"""

import argparse
import sys
from collections.abc import Sequence

#: The refusal every M0 subcommand answers with, followed by its own name.
REFUSAL = "NOT_IMPLEMENTED_UNTIL_M1"

#: A subcommand that exists and declines. Usage errors keep argparse's own 2.
EXIT_REFUSED = 3

SUBCOMMANDS = {
    "ingest": "Read a drawing into the entity graph (M1).",
    "validate": "Check a drawing without ingesting it (M1).",
}


def build_parser() -> argparse.ArgumentParser:
    """The M0 surface: a subcommand and the drawing it applies to."""
    parser = argparse.ArgumentParser(
        prog="vextrus-cad",
        description="Vextrus CAD ingestion. Every subcommand refuses until M1.",
    )
    # `required`: a bare `vextrus-cad` is a usage error, not a silent no-op.
    subcommands = parser.add_subparsers(
        dest="subcommand", metavar="{ingest,validate}", required=True
    )
    for name, help_text in SUBCOMMANDS.items():
        subcommand = subcommands.add_parser(name, help=help_text, description=help_text)
        subcommand.add_argument("path", help=f"the drawing to {name}")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Parse, then refuse. Returns the exit code; argparse exits 2 on its own."""
    arguments = build_parser().parse_args(argv)
    print(f"{REFUSAL} {arguments.subcommand}")
    return EXIT_REFUSED


if __name__ == "__main__":
    sys.exit(main())
