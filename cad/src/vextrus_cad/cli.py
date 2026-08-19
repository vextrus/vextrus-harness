"""The `vextrus-cad` console entry.

In M0 there is no ingestion: both subcommands parse their arguments like the
real thing and then refuse by name, so the shape of the surface is settled and
callable while the conversion behind it is still M1's work.

Two exit codes carry that apart, because they mean different things to whoever
scripted the call: 2 is "you asked wrongly" (argparse's own convention — the
usage text goes to stderr), 3 is "you asked correctly and the answer is no".
A refusal prints exactly one line on stdout, `NOT_IMPLEMENTED_UNTIL_M1 <cmd>`,
so a caller can read the reason without parsing prose.
"""

from __future__ import annotations

import argparse
from collections.abc import Sequence

#: The refusal every M0 subcommand answers with. L-CAD-04's loud failure, early.
REFUSAL = "NOT_IMPLEMENTED_UNTIL_M1"

#: Exit code for a well-formed request the lane cannot serve yet.
EXIT_REFUSED = 3

SUBCOMMANDS = ("ingest", "validate")


def build_parser() -> argparse.ArgumentParser:
    """The parser, built once and shared by the entry point and its tests."""
    parser = argparse.ArgumentParser(
        prog="vextrus-cad",
        description="Vextrus CAD lane (M0: parses and refuses).",
    )
    # `required`, so a bare `vextrus-cad` is a usage error rather than a silent
    # no-op: argparse answers that with its usage text on stderr and exit 2.
    subparsers = parser.add_subparsers(dest="subcommand", required=True)
    for name in SUBCOMMANDS:
        sub = subparsers.add_parser(name, help=f"{name} a drawing (M1)")
        sub.add_argument("path", help="path to the drawing")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Parse, then refuse. Returns the process exit code."""
    args = build_parser().parse_args(argv)
    print(f"{REFUSAL} {args.subcommand}")
    return EXIT_REFUSED


if __name__ == "__main__":  # pragma: no cover - exercised through the console entry
    raise SystemExit(main())
