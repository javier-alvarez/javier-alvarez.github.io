#!/usr/bin/env python3
"""Structural checks for the site, run in CI.

  - every script, stylesheet, font, icon and image the page loads is local
    and exists (no third-party requests)
  - every image has alt text
  - the HTML nests correctly and the JSON-LD parses
  - text colours in both themes meet WCAG AA contrast (4.5:1)
"""

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
LOADED_LINK_RELS = {"stylesheet", "preload", "icon", "modulepreload", "manifest"}

# (foreground, background) token pairs used for text.
TEXT_PAIRS = [
    ("--ink", "--bg"), ("--muted", "--bg"), ("--muted", "--bg-elev"),
    ("--faint", "--bg"), ("--faint", "--bg-elev"),
    ("--accent", "--bg"), ("--accent", "--bg-elev"), ("--accent-2", "--bg"),
]


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.errors, self.loads, self.images = [], [], [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "script" and a.get("src"):
            self.loads.append(a["src"])
        if tag == "link" and LOADED_LINK_RELS & set(a.get("rel", "").split()):
            self.loads.append(a.get("href", ""))
        if tag == "img":
            self.loads.append(a.get("src", ""))
            self.images.append(a)
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        else:
            self.errors.append(f"unexpected </{tag}> (open: {self.stack[-3:]})")


def luminance(hex_colour):
    h = hex_colour.lstrip("#")
    channels = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def theme_tokens(css, selector):
    block = re.search(re.escape(selector) + r"\s*\{(.*?)\}", css, re.S)
    return dict(re.findall(r"(--[\w-]+):\s*(#[0-9a-fA-F]{6})", block.group(1))) if block else {}


def main():
    problems = []
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "assets" / "styles.css").read_text(encoding="utf-8")

    page = Page()
    page.feed(html)
    problems += page.errors
    if page.stack:
        problems.append(f"unclosed tags: {page.stack}")

    for src in page.loads:
        if re.match(r"^(https?:)?//", src):
            problems.append(f"third-party resource: {src}")
        elif not (ROOT / src).is_file():
            problems.append(f"missing file: {src}")
    for url in re.findall(r"url\(([^)]+)\)", css):
        url = url.strip("'\"")
        if re.match(r"^(https?:)?//", url):
            problems.append(f"third-party resource in CSS: {url}")
        elif not url.startswith("data:") and not (ROOT / "assets" / url).is_file():
            problems.append(f"missing file referenced from CSS: {url}")

    for img in page.images:
        if not img.get("alt", "").strip():
            problems.append(f"image without alt text: {img.get('src')}")

    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        try:
            json.loads(block)
        except json.JSONDecodeError as error:
            problems.append(f"JSON-LD does not parse: {error}")

    themes = {"light": theme_tokens(css, ':root[data-theme="light"]'),
              "dark": theme_tokens(css, ':root[data-theme="dark"]')}
    for theme, tokens in themes.items():
        if not tokens:
            problems.append(f"could not read {theme} theme colours")
            continue
        for fg, bg in TEXT_PAIRS:
            ratio = contrast(tokens[fg], tokens[bg])
            if ratio < 4.5:
                problems.append(f"{theme} theme: {fg} on {bg} is {ratio:.2f}:1, below WCAG AA 4.5:1")

    if problems:
        print(f"site checks: {len(problems)} problem(s):")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print(f"site checks: {len(page.loads)} local resources, {len(page.images)} images, "
          f"{len(TEXT_PAIRS) * 2} colour pairs: all good.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
