"""Vextrus CAD ingestion.

M0 stands the package up and stops there: `vextrus-cad` parses its arguments and
refuses with `NOT_IMPLEMENTED_UNTIL_M1`. No drawing is read, converted or stored
until M1 wires LibreDWG, ezdxf and pypdfium2 behind it (L-CAD-04).
"""

__all__ = ["__version__"]

__version__ = "0.0.0"
