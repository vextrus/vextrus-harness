"""Authors `out/smoke_lines.dxf` — the smallest DXF the lane can be pointed at.

L-CAD-09: fixtures are synthetic drawings authored by committed scripts, never
competitor-derived files. This one is deliberately dull — a closed rectangle, a
diagonal and a circle on two named layers — because its job in M0 is to be a real
DXF that ezdxf (MIT, L-CAD-04) wrote, not to be interesting.

Byte-determinism is the whole contract (AC-05): `pnpm gen:fixtures` twice must
leave the tree untouched, and a freshly written DXF is stamped four ways — two
random GUIDs, `$TDUPDATE`, and an ezdxf marker string carrying the current time
into a DICTIONARYVAR. `write_fixed_meta_data_for_testing` is ezdxf's own switch
for exactly that set, so it is preferred here over hand-pinning header variables
the writer would overwrite on export anyway.

One stamp is not ezdxf's to fix: the OBJECTS section is emitted in a dict order
that follows Python's randomised string hashing, so two runs can swap a LAYOUT
and an ACDBPLACEHOLDER and nothing else. `scripts/gen-fixtures.mjs` therefore
runs every generator under `PYTHONHASHSEED=0`; run this script by hand and set it
yourself, or the bytes will wander. With both in place, a diff in this fixture
means the geometry changed and nothing else.
"""

from pathlib import Path

import ezdxf

# Before the document exists: the creation marker is stamped in `ezdxf.new`.
ezdxf.options.write_fixed_meta_data_for_testing = True

OUT = Path(__file__).resolve().parent / "out" / "smoke_lines.dxf"

CORNERS = [(0.0, 0.0), (100.0, 0.0), (100.0, 50.0), (0.0, 50.0)]


def build() -> ezdxf.document.Drawing:
    """A rectangle, a diagonal and a circle across two layers."""
    doc = ezdxf.new("R2010", setup=False)
    doc.layers.add("OUTLINE", color=7)
    doc.layers.add("DETAIL", color=1)

    model = doc.modelspace()
    for index, start in enumerate(CORNERS):
        end = CORNERS[(index + 1) % len(CORNERS)]
        model.add_line(start, end, dxfattribs={"layer": "OUTLINE"})
    model.add_line(CORNERS[0], CORNERS[2], dxfattribs={"layer": "DETAIL"})
    model.add_circle((50.0, 25.0), radius=10.0, dxfattribs={"layer": "DETAIL"})
    return doc


def main() -> None:
    doc = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # An explicit newline: the fixture is committed, so it is LF on every machine
    # that regenerates it rather than CRLF on one of them.
    with OUT.open("w", encoding="utf-8", newline="\n") as stream:
        doc.write(stream, fmt="asc")
    print(f"wrote {OUT.name}")


if __name__ == "__main__":
    main()
