"""Nicked brand colours for the annotated video, as OpenCV BGR tuples.

"Monitor, not movie": footage keeps a plain mono overlay, the way it looks on
the owner's screen. One signal colour: Signal Orange is only for the person
the tracker wants a human to look at. Everything else stays neutral.
"""


def _bgr(hex_colour: str) -> tuple[int, int, int]:
    h = hex_colour.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    return (b, g, r)


SIGNAL_ORANGE = _bgr("#FF541C")  # flags only: the flagged box, REC dot
NAVY = _bgr("#0E1F35")  # label chips
CCTV_FEED = _bgr("#0B1524")  # overlay bar background
HAIRLINE = _bgr("#D9DEE6")  # people who are not flagged
CONTROL_BORDER = _bgr("#7D8A9C")  # zone outlines
WHITE = _bgr("#FFFFFF")
