"""Authors `out/smoke_page.pdf`: the smallest vector PDF the lane can be pointed at.

D-04 picks the permissive vector-PDF writer for fixture generation, and this is
where that pick is spent: a BSD writer, used here and banned from the app by the
licence scan (L-CAD-04 bans the AGPL readers outright; the BSD writer is simply
not something shipped code has any business importing).

Vector, not raster: the page is lines, a rectangle and text, so a later reader
has real path operators to recover rather than pixels to guess at.

A PDF carries a creation date, a modification date and a document ID, all three
of which change every run. The writer has one switch for exactly this — the
invariant mode its own test suite uses — so the fixture asks for that rather
than patching bytes afterwards.
"""

from __future__ import annotations

from pathlib import Path

from reportlab import rl_config

# Before any other import from the writer: the flag is read when its canvas
# module is first configured, so setting it afterwards would be too late.
rl_config.invariant = 1

from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.pdfgen import canvas  # noqa: E402

OUT = Path(__file__).resolve().parent / "out" / "smoke_page.pdf"

MARGIN = 40.0


def draw(pdf: canvas.Canvas) -> None:
    width, height = A4

    pdf.setTitle("Vextrus smoke page")
    pdf.setAuthor("fixtures/gen/gen_smoke_page.py")
    pdf.setSubject("Synthetic vector fixture (L-CAD-09)")

    pdf.setLineWidth(1.0)
    pdf.rect(MARGIN, MARGIN, width - 2 * MARGIN, height - 2 * MARGIN, stroke=1, fill=0)

    pdf.setLineWidth(0.5)
    for step in range(1, 5):
        y = MARGIN + step * 40.0
        pdf.line(MARGIN, y, width - MARGIN, y)

    pdf.setFont("Helvetica", 14)
    pdf.drawString(MARGIN + 12.0, height - MARGIN - 30.0, "VEXTRUS SMOKE PAGE")
    pdf.setFont("Helvetica", 9)
    pdf.drawString(MARGIN + 12.0, height - MARGIN - 48.0, "synthetic fixture — no drawing content")


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(OUT), pagesize=A4, invariant=1, pageCompression=0)
    draw(pdf)
    pdf.showPage()
    pdf.save()


if __name__ == "__main__":
    main()
