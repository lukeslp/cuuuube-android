# CUUUUBE for Android

[![Web](https://img.shields.io/badge/web-play_in_the_browser-4ad7d1?style=flat-square)](https://dr.eamer.dev/games/cube/)
[![App Store](https://img.shields.io/badge/App_Store-iPhone_and_iPad-blue?style=flat-square)](https://apps.apple.com/us/app/cuuuube/id6780109662)
[![Android download](https://img.shields.io/badge/Android-direct_download-34A853?style=flat-square)](https://dr.eamer.dev/downloads/apps/cuuuube/)
[![F-Droid repository](https://img.shields.io/badge/F--Droid-LocalType_releases_repo-1976D2?style=flat-square)](https://dr.eamer.dev/downloads/fdroid/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE.txt)

A 3D cube puzzle, from 2×2 to 5×5, with a solve timer and a top-10 scoreboard
for each size. The game is plain HTML, CSS and JavaScript in `web/`, running in
a locked-down Android WebView. It requests no permissions, blocks network loads
and keeps scores and settings on the device.

The game is based on Boris Šehovac's Three.js Rubik's cube
([CodePen `EMyWVv`](https://codepen.io/bsehovac/pen/EMyWVv), MIT), extended with
cube sizes, themes, a timer and leaderboards.

## Build

JDK 21 and the Android SDK (platform 36) are required. From the repository root:

```sh
./android/gradlew -p android :app:testReleaseUnitTest :app:assembleRelease
```

The release APK is unsigned unless the `CUBE_RELEASE_*` signing values are set
in the environment. Signing values are never kept in this repository.

`fdroid/verify-apk.py` checks a built APK against this tree: package, version,
SDK levels, no permissions, no native code, every file in `web/` shipped
unchanged, and every license notice listed in `docs/FDROID_NOTICE_SOURCES.json`.

## Releases and F-Droid

Releases are tagged `v<version>`. Each GitHub release carries the APK signed
with the same key as every other CUUUUBE download (certificate SHA-256
`dd8274b9096de5ef65590b2e5581226772737028753313a806c9e4de899f6126`). F-Droid
rebuilds the APK from the tag, checks it matches the signed release, and ships
that signed file, so copies from any of these sources update each other.

## Licenses

- CUUUUBE app shells, extensions and launcher artwork: MIT (`LICENSE.txt`).
- Original game: MIT, Boris Šehovac.
- Three.js r95: MIT. The game ships the official minified `three.min.js`;
  the readable build is in `third_party/three-r95/`.
- Space Grotesk 2.0.0 and Bungee: SIL Open Font License 1.1.
- Feather icons and three-rounded-box geometry: MIT.

Full texts ship inside the app under `web/licenses/`, and the Licenses button on
the Best Times screen shows them. `docs/FDROID.md` records the provenance review.
