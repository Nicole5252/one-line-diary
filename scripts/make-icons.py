# Generates app icons: white ground, three solid black squares in an L shape with thin gaps.
from PIL import Image, ImageDraw
import os
out = os.path.join(os.path.dirname(__file__), "..", "public")
def make(size, name):
    im = Image.new("RGB", (size, size), "white")
    d = ImageDraw.Draw(im)
    cell = size * 0.2; gap = size * 0.02
    total = cell * 2 + gap
    x0 = y0 = (size - total) / 2
    for cx, cy in [(0, 0), (0, 1), (1, 1)]:
        x = x0 + cx * (cell + gap); y = y0 + cy * (cell + gap)
        d.rectangle([round(x), round(y), round(x + cell) - 1, round(y + cell) - 1], fill="black")
    im.save(os.path.join(out, name))
make(180, "apple-touch-icon.png"); make(192, "icon-192.png"); make(512, "icon-512.png")
