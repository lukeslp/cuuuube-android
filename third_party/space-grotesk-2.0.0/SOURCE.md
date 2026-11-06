# Space Grotesk 2.0.0

- Upstream: https://github.com/floriankarsten/space-grotesk
- Tag `2.0.0`, commit `7220f5d04813fe83babe76d4fd23e02275021280` (2020-10-29).
- File: `fonts/woff2/SpaceGrotesk[wght].woff2`, renamed here to
  `SpaceGrotesk-wght.woff2` (file name only; the font is unmodified).
- SHA-256 `8e085aa438094f11487a836652edd5c054fa6a96f63fc7c282105ee3a4b08c07`,
  49,256 bytes. Identical on the tag and on `master` (checked 2026-11-06).
- License: SIL Open Font License 1.1, `OFL.txt` copied from the same commit
  (SHA-256 `564ce565c371c5e5bbf286006565a7c9aa55a9f56e7ca58d56e05d649dd61a72`).
  No Reserved Font Name is declared. Authors are listed in `AUTHORS.txt`.
- Use: `web/style.css` embeds these exact bytes as a base64 `data:` URI in its
  first `@font-face` rule, so the game shows its intended typeface offline on
  Android and iOS. It replaced a Google Fonts `@import` on 2026-11-06.
  `CanonicalWebAssetsTest` decodes the URI and checks this hash.
- Font sources (Glyphs files) and the fontmake build live in the upstream
  repository at the same commit.
