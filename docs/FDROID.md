# CUUUUBE on F-Droid: provenance and build verification

Last checked November 6, 2026, for version 1.0.6 (6).

## What ships

The APK is a small Kotlin shell (`android/app/src/main`) around the game in
`web/`, which Gradle packages unchanged as assets. The shell enables JavaScript
and DOM storage; blocks network loads, `content://` access, cross-file script
access and pop-up windows; and opens user-activated web links in the browser. The manifest requests no permissions and requires a touchscreen.
`fdroid/verify-apk.py` checks all of this against a built APK.

The release runtime classpath is `org.jetbrains.kotlin:kotlin-stdlib:2.2.21`
and `org.jetbrains:annotations:13.0`. Both match the official Maven Central
binaries, POMs and source archives (`docs/FDROID_RUNTIME_COMPONENTS.json`).
There is no native code, no Google Play Services, Firebase, ads or analytics.

## Components and licenses

| Component | Evidence | License notice in the APK |
| --- | --- | --- |
| Original cube game | Boris Šehovac, CodePen `EMyWVv`, explicit MIT grant; the supplied 2025 notice is kept beside the current CodePen grant | `The-Cube-2025-MIT.txt`, `The-Cube-CodePen-2026-MIT.txt` |
| App shells, game extensions, launcher art | Luke Steuber, 2026 | `CUUUUBE-2026-MIT.txt`, root `LICENSE.txt` |
| Three.js r95 | `web/vendor/three.min.js` is byte-identical to the official r95 `build/three.min.js` (SHA-256 `bc5ccd5a…b4c8b0`); the readable r95 build is in `third_party/three-r95/` | `Three-r95-MIT.txt` |
| RoundedBoxGeometry | Matches the original game's copy of `three-rounded-box` 0.1.0 (Dusan Bosnjak / pailhead, package declares MIT); author credits kept in `web/script.js` | `Three-Rounded-Box-MIT.txt` |
| Bungee Regular 1.000 | Embedded WOFF2 is byte-identical to the original game's (David Jonathan Ross) | `Bungee-OFL-1.1.txt` |
| Space Grotesk 2.0.0 | Embedded WOFF2 is byte-identical to upstream tag `2.0.0`, commit `7220f5d`; see `third_party/space-grotesk-2.0.0/SOURCE.md` | `Space-Grotesk-OFL-1.1.txt` |
| Feather icons (refresh, home) | Path geometry matches Feather `refresh-ccw` and `home` | `Feather-MIT.txt` |
| Kotlin stdlib, JetBrains annotations | Official Maven artifacts, see above | `Apache-2.0.txt`, `Kotlin-ThreeTenBP-BSD-3-Clause.txt`, `Kotlin-Boost-1.0.txt`, `Kotlin-and-Annotations-Credits.txt` |

Every notice's source URL and SHA-256 is in `docs/FDROID_NOTICE_SOURCES.json`,
and the verifier checks the APK copy against that hash. A JVM test checks the
embedded Space Grotesk bytes against the pinned upstream hash and rejects any
remote URL in the stylesheet.

Two limits are recorded rather than papered over. The rounded-box package
declares MIT but never shipped a license file, so the notice uses the standard
MIT text with the actual author credits and no invented copyright year. The
minified Three.js file is the official release artifact, not rebuilt from the
r95 sources here.

## Build and reproducibility

JDK 21, Android SDK platform 36, AGP 8.13.0, Kotlin 2.2.21, Gradle 8.14.5
(wrapper checksum pinned). Release builds omit the version-control info file
and the dependency-metadata signing block, so the bytes do not depend on how
the source was checked out.

For 1.0.6 (6) the unsigned release APK has SHA-256
`228464eb3580df0834bdddae42d28daf5bb966c5517405e85845638d965ce1fa` from all of:

- two clean macOS Gradle builds, one with the build cache off;
- fdroidserver 2.4.5 `fdroid build` from the exported source, with its source
  scan, non-free class scan and extra-signing-block scan reporting nothing;
- the Linux CI job (Ubuntu 24.04, Temurin 21).

The release APK is that unsigned file signed with v2 and v3 schemes and the
ZIP alignment preserved (`fdroid/sign-upstream.sh`). Its signer certificate
SHA-256 is `dd8274b9096de5ef65590b2e5581226772737028753313a806c9e4de899f6126`,
the same key as every earlier CUUUUBE download, so installs update in place.
fdroidserver's `verify_apks` confirms the signed APK is the unsigned F-Droid
build plus that signature.

## Device checks

On a Pixel 9a (Android 17), the signed 1.0.6 installed over 1.0.5 in place: the
app ID and first-install time were unchanged, the installed file matched the
release hash, and the chosen color theme carried over. The game launched with
Space Grotesk lettering, turned layers, ran the timer, switched to 3×3 and
opened the scoreboard, with no crash or WebView console errors in the log.

Not yet checked: TalkBack, large system font sizes, an Android image without
Google services, and the Galaxy Z Flip cover screen. Each launch starts a new
run, so an unfinished solve does not resume.
