#!/usr/bin/env python3
"""Write web/licenses/index.html, the notices page the game shows in the app.

The page is every text file in web/licenses/, unchanged, one after another,
under the name of the component it covers. Run this after adding or changing a
notice; a JVM test fails if the page and the text files disagree.
"""
import html
from pathlib import Path

LICENSES = Path(__file__).resolve().parents[1] / "web/licenses"
SECTIONS = [
    ("CUUUUBE app, game extensions and launcher artwork", "CUUUUBE-2026-MIT.txt"),
    ("The Cube, the original game by Boris Šehovac", "The-Cube-CodePen-2026-MIT.txt"),
    ("The Cube, notice supplied with the 2025 source", "The-Cube-2025-MIT.txt"),
    ("Three.js r95", "Three-r95-MIT.txt"),
    ("RoundedBoxGeometry (three-rounded-box)", "Three-Rounded-Box-MIT.txt"),
    ("Bungee typeface", "Bungee-OFL-1.1.txt"),
    ("Space Grotesk typeface", "Space-Grotesk-OFL-1.1.txt"),
    ("Feather icons", "Feather-MIT.txt"),
    ("Kotlin standard library and JetBrains annotations: credits", "Kotlin-and-Annotations-Credits.txt"),
    ("Kotlin standard library and JetBrains annotations: Apache License 2.0", "Apache-2.0.txt"),
    ("Kotlin standard library: ThreeTenBP notice", "Kotlin-ThreeTenBP-BSD-3-Clause.txt"),
    ("Kotlin standard library: Boost notice", "Kotlin-Boost-1.0.txt"),
]
assert sorted(name for _, name in SECTIONS) == sorted(p.name for p in LICENSES.glob("*.txt")), \
    "SECTIONS must list every notice in web/licenses exactly once"

HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>CUUUUBE license notices</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body { margin: 0; padding: 1em 1.1em 2em; background: #fff; color: #111;
  font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
h1 { font-size: 1.25em; margin: 0 0 0.4em; }
h2 { font-size: 1em; margin: 1.6em 0 0.5em; padding-top: 0.9em; border-top: 1px solid #bbb; }
pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere;
  font: 0.8em/1.45 ui-monospace, Menlo, Consolas, monospace; }
</style>
</head>
<body>
<h1>CUUUUBE license notices</h1>
<p>CUUUUBE is built from the components below. Each notice is the full text that ships with the app.</p>
"""

parts = [HEAD]
for title, name in SECTIONS:
    # Bytes, not read_text: one notice has CRLF line ends and must stay as it is.
    text = (LICENSES / name).read_bytes().decode("utf-8")
    parts.append("<h2>%s</h2>\n<pre>%s</pre>\n" % (html.escape(title), html.escape(text, quote=False)))
parts.append("</body>\n</html>\n")
(LICENSES / "index.html").write_bytes("".join(parts).encode("utf-8"))
print(LICENSES / "index.html")
