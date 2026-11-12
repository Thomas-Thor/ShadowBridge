"""Static checks for the homepage banner (Image A) and hero globe (Image B).
Run: python3 -m unittest discover -s tests -v   (stdlib only)."""

import struct
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def image_size(path):
    data = path.read_bytes()
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        chunk = data[12:16]
        if chunk == b"VP8X":
            w = int.from_bytes(data[24:27], "little") + 1
            h = int.from_bytes(data[27:30], "little") + 1
            return w, h, any(c in data[12:64] for c in (b"EXIF", b"XMP "))
        if chunk == b"VP8 ":
            w, h = struct.unpack("<HH", data[26:30])
            return w & 0x3FFF, h & 0x3FFF, False
        if chunk == b"VP8L":
            bits = int.from_bytes(data[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1, False
    if data[:2] == b"\xff\xd8":
        i, exif = 2, False
        while i < len(data):
            marker, length = data[i + 1], struct.unpack(">H", data[i + 2:i + 4])[0]
            exif = exif or (marker == 0xE1)
            if marker in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return w, h, exif
            i += 2 + length
    raise ValueError(f"unsupported image {path}")


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.tags, self.stack = [], []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs), tuple(t for t, _ in self.stack)))
        if tag not in ("img", "source", "meta", "link", "br", "input", "path"):
            self.stack.append((tag, dict(attrs)))

    def handle_endtag(self, tag):
        while self.stack and self.stack[-1][0] != tag:
            self.stack.pop()
        if self.stack:
            self.stack.pop()


HTML = (ROOT / "index.html").read_text(encoding="utf-8")
PAGE = Page(HTML)


def srcset_files(value):
    return [(ROOT / part.split()[0], int(part.split()[1][:-1])) for part in value.split(",")]


class HomepageGraphics(unittest.TestCase):
    def test_banner_is_the_first_thing_in_main_above_the_hero(self):
        main = HTML.index('<main id="main"')
        self.assertLess(main, HTML.index('class="site-banner"'))
        self.assertLess(HTML.index('class="site-banner"'), HTML.index('id="home" class="hero'))
        between = HTML[HTML.index(">", main) + 1:HTML.index('class="site-banner"')]
        self.assertEqual(between.strip(), "<section")

    def test_every_referenced_variant_exists_with_declared_width_and_no_metadata(self):
        checked = 0
        for tag, attrs, _ in PAGE.tags:
            if tag == "source" and "assets/hero/" in attrs.get("srcset", ""):
                for path, width in srcset_files(attrs["srcset"]):
                    w, h, meta = image_size(path)
                    self.assertEqual(w, width, path.name)
                    self.assertFalse(meta, path.name)
                    checked += 1
        self.assertEqual(checked, 7)

    def test_declared_dimensions_match_files_so_layout_does_not_shift(self):
        images = {a.get("src"): a for t, a, _ in PAGE.tags if t == "img"}
        for src, size in {"assets/hero/sb-banner-2000.jpg": (2000, 414), "assets/hero/global-bridge-953.jpg": (953, 685)}.items():
            self.assertIn(src, images, "image missing from the page")
            attrs = images[src]
            self.assertEqual((int(attrs["width"]), int(attrs["height"])), size)
            self.assertEqual(image_size(ROOT / src)[:2], size)
            self.assertTrue(attrs.get("alt", "").strip())

    def test_mobile_banner_crop_and_source_aspect_ratios(self):
        mobile = [a for t, a, _ in PAGE.tags if t == "source" and a.get("media") == "(max-width: 640px)"]
        self.assertEqual(len(mobile), 1)
        self.assertEqual((mobile[0]["width"], mobile[0]["height"]), ("1130", "414"))
        for path, _ in srcset_files(mobile[0]["srcset"]):
            w, h, _ = image_size(path)
            self.assertAlmostEqual(w / h, 1130 / 414, places=2)
        for name in ("sb-banner-1000.webp", "sb-banner-1400.webp", "sb-banner-2000.webp"):
            w, h, _ = image_size(ROOT / "assets/hero" / name)
            self.assertAlmostEqual(w / h, 2000 / 414, places=2)

    def test_old_svg_artwork_is_fully_replaced(self):
        self.assertFalse((ROOT / "assets/global-bridge.svg").exists())
        for path in [ROOT / "index.html", ROOT / "assets/styles.css", ROOT / "cartel/index.html"]:
            self.assertNotIn("global-bridge.svg", path.read_text(encoding="utf-8"))

    def test_image_weight_stays_reasonable(self):
        limits = {"sb-banner-mobile-760.webp": 40_000, "sb-banner-1000.webp": 40_000, "sb-banner-2000.webp": 90_000,
                  "global-bridge-640.webp": 80_000, "global-bridge-953.webp": 150_000}
        for name, limit in limits.items():
            self.assertLessEqual((ROOT / "assets/hero" / name).stat().st_size, limit, name)


if __name__ == "__main__":
    unittest.main()
