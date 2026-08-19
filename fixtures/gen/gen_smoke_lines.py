"""Authors `out/smoke_lines.dxf`: the smallest DXF the lane can be pointed at.

L-CAD-09: fixtures are synthetic drawings authored by committed scripts, and
competitor-derived drawings never enter the repository. So the drawing is a few
lines and a circle on two layers — enough to have entities, layers and an extent
to disagree about later, and nothing that came from anywhere else.

Byte-determinism is the whole point of committing the output beside the script:
`pnpm gen:fixtures` must reproduce the committed bytes exactly, or the script is
not the source of truth the manifest claims it is. DXF carries four clocks and
two GUIDs, all of them stamped by the writer at write time, so the fixture asks
ezdxf for its invariant mode — the same switch ezdxf's own regression tests use
— rather than setting header variables the writer would immediately overwrite.
The DXF version is named explicitly for the same reason: the bytes must not
follow whatever the installed ezdxf prefers this month.
"""

from __future__ import annotations

from pathlib import Path

import ezdxf

OUT = Path(__file__).resolve().parent / "out" / "smoke_lines.dxf"

WALLS = [((0.0, 0.0), (100.0, 0.0)), ((100.0, 0.0), (100.0, 60.0)),
         ((100.0, 60.0), (0.0, 60.0)), ((0.0, 60.0), (0.0, 0.0))]


def build() -> ezdxf.document.Drawing:
    # Fixed timestamps, fixed GUIDs, fixed `created by` marker: everything the
    # writer would otherwise stamp with the wall clock.
    ezdxf.options.write_fixed_meta_data_for_testing = True

    doc = ezdxf.new("R2010", setup=False)
    doc.header["$TDINDWG"] = 0.0

    doc.layers.add("WALLS", color=7)
    doc.layers.add("NOTES", color=3)

    model = doc.modelspace()
    for start, end in WALLS:
        model.add_line(start, end, dxfattribs={"layer": "WALLS"})
    model.add_circle((50.0, 30.0), radius=12.5, dxfattribs={"layer": "WALLS"})
    model.add_text(
        "SMOKE",
        height=4.0,
        dxfattribs={"layer": "NOTES"},
    ).set_placement((4.0, 52.0))

    return doc


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # `newline=""` and an explicit encoding: the committed bytes must not depend
    # on the platform's line endings or locale.
    with OUT.open("w", encoding="utf-8", newline="") as stream:
        build().write(stream, fmt="asc")


if __name__ == "__main__":
    main()
