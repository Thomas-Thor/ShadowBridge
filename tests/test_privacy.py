"""Focused static checks. Run: python3 -m unittest discover -s tests -v."""

import re
import unittest
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://shadow-bridge.eu"


class Document(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.links = []
        self.assets = []
        self.tags = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append((tag, attrs))
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag == "a" and attrs.get("href"):
            self.links.append(attrs["href"])
        if tag in ("img", "script") and attrs.get("src"):
            self.assets.append(attrs["src"])
        if tag == "link" and attrs.get("rel") in ("stylesheet", "icon", "preload"):
            self.assets.append(attrs["href"])


def local_path(url):
    path = ROOT / unquote(urlsplit(url).path).lstrip("/")
    return path / "index.html" if path.is_dir() else path


class PrivacyTests(unittest.TestCase):
    def test_local_navigation_assets_and_fragments(self):
        for route in ("/", "/privacy/"):
            document = Document(local_path(ORIGIN + route).read_text())
            for ref in document.links + document.assets:
                with self.subTest(route=route, ref=ref):
                    target = urlsplit(urljoin(ORIGIN + route, ref))
                    if target.scheme not in ("http", "https") or target.netloc != "shadow-bridge.eu":
                        continue
                    path = local_path(target.geturl())
                    self.assertTrue(path.is_file(), f"Missing local target: {ref}")
                    if target.fragment:
                        self.assertIn(unquote(target.fragment), Document(path.read_text()).ids)

    def test_stylesheets_resolve_including_shared_fonts(self):
        for name in ("styles.css", "privacy.css"):
            path = ROOT / "assets" / name
            for ref in re.findall(r"url\([\"']?([^\"')]+)", path.read_text()):
                with self.subTest(stylesheet=name, ref=ref):
                    self.assertTrue((path.parent / ref).is_file())

    def test_policy_landmarks_and_metadata(self):
        document = Document((ROOT / "privacy/index.html").read_text())
        self.assertEqual(len(document.ids), len(set(document.ids)), "Duplicate policy IDs")
        self.assertEqual(sum(tag == "h1" for tag, _ in document.tags), 1)
        self.assertEqual(sum(tag == "main" for tag, _ in document.tags), 1)
        self.assertTrue(any(tag == "html" and attrs.get("lang") == "en" for tag, attrs in document.tags))
        self.assertTrue(any(tag == "link" and attrs.get("rel") == "canonical" and attrs.get("href") == ORIGIN + "/privacy/" for tag, attrs in document.tags))
        self.assertIn("#main", document.links)
        self.assertFalse(any(tag in ("script", "iframe", "form") for tag, _ in document.tags), "The policy must be readable without scripts or sign-in")

    def test_homepage_policy_link_is_in_footer(self):
        html = (ROOT / "index.html").read_text()
        footer = html[html.index("<footer"):html.index("</footer>")]
        self.assertRegex(footer, r'<a href="/privacy/">Privacy Policy</a>')

    def test_sitemap_includes_public_policy_route(self):
        tree = ET.parse(ROOT / "sitemap.xml")
        urls = [element.text for element in tree.findall(".//{*}loc")]
        self.assertIn(ORIGIN + "/privacy/", urls)
        for url in urls:
            self.assertTrue(local_path(url).is_file(), url)


if __name__ == "__main__":
    unittest.main()
