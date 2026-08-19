"""Authors `out/smoke_page.pdf` — the smallest vector PDF the lane can be pointed at.

D-04 picks reportlab (BSD) as the permissive vector-PDF writer for fixtures, and
this script is the whole of that decision: reportlab is a *generator* dependency,
never an application one, which is why it is pinned in the `fixtures` dependency
group and why the licence scan refuses it anywhere else (L-CAD-04).

Vector, not raster, on purpose: the page is lines, a rectangle and text, so a
reader of this fixture is reading real page geometry rather than an image of it.

`invariant` is what makes AC-05 possible — reportlab otherwise stamps the current
time into `/CreationDate`, `/ModDate` and the file identifier, and two runs of an
unchanged script would differ.
"""

from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent / "out" / "smoke_page.pdf"

WIDTH, HEIGHT = A4


def draw(page: canvas.Canvas) -> None:
    """A titled frame with a hatch of rules — enough geometry to be worth parsing."""
    page.setTitle("Vextrus smoke page")
    page.setAuthor("vextrus")
    page.setSubject("M0 synthetic vector fixture")

    page.setLineWidth(0.8)
    page.rect(20 * mm, 20 * mm, WIDTH - 40 * mm, HEIGHT - 40 * mm)

    page.setLineWidth(0.3)
    for step in range(1, 10):
        y = 20 * mm + step * (HEIGHT - 40 * mm) / 10
        page.line(20 * mm, y, WIDTH - 20 * mm, y)

    page.setFont("Helvetica", 12)
    page.drawString(25 * mm, HEIGHT - 30 * mm, "VEXTRUS — smoke page")
    page.drawString(25 * mm, HEIGHT - 36 * mm, "synthetic fixture, no drawing content")


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # `invariant=1`: fixed CreationDate/ModDate and a content-derived file id.
    page = canvas.Canvas(str(OUT), pagesize=A4, invariant=1)
    draw(page)
    page.showPage()
    page.save()
    print(f"wrote {OUT.name}")


if __name__ == "__main__":
    main()
