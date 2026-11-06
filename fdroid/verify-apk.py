#!/usr/bin/env python3
"""Check a CUUUUBE release APK against its source tree and F-Droid recipe.

Run it on the unsigned F-Droid build, or with --signed-cert on the upstream
signed release. It reads files only and prints a JSON summary.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "com.lukesteuber.cube"
FORBIDDEN_DEX = (b"Lcom/google/android/gms/", b"Lcom/google/android/play/",
                 b"Lcom/google/firebase/", b"Lcom/google/mlkit/")
SIGNING_BLOCKS = {0x7109871A: "v2", 0xF05368C0: "v3", 0x1B93AD61: "v3.1",
                  0x42726577: "verity-padding", 0x504B4453: "dependency-metadata",
                  0x6DFF800D: "source-stamp", 0x2146444E: "play-frosting"}
ALLOWED_BLOCKS = {"v2", "v3", "v3.1", "verity-padding"}

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("apk", type=Path)
parser.add_argument("--build-tools", type=Path, required=True)
parser.add_argument("--metadata", type=Path, default=ROOT / "fdroid/metadata/com.lukesteuber.cube.yml")
parser.add_argument("--signed-cert", help="expected signer SHA-256 (hex); omit for the unsigned build")
args = parser.parse_args()


def signing_blocks(data):
    eocd = data.rfind(b"PK\x05\x06")
    assert eocd >= 0, "Not a ZIP archive"
    cd_offset = struct.unpack("<I", data[eocd + 16:eocd + 20])[0]
    if data[cd_offset - 16:cd_offset] != b"APK Sig Block 42":
        return []
    size = struct.unpack("<Q", data[cd_offset - 24:cd_offset - 16])[0]
    position, end, found = cd_offset - size + 0, cd_offset - 24, []
    while position < end:
        length = struct.unpack("<Q", data[position:position + 8])[0]
        block = struct.unpack("<I", data[position + 8:position + 12])[0]
        found.append(SIGNING_BLOCKS.get(block, hex(block)))
        position += 8 + length
    return found


apk_bytes = args.apk.read_bytes()
badging = subprocess.run([str(args.build_tools / "aapt2"), "dump", "badging", str(args.apk)],
                         capture_output=True, text=True, check=True).stdout
package = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
assert package and package[1] == PACKAGE, "Unexpected package"
assert "application-debuggable" not in badging, "Release is debuggable"

properties = dict(line.split("=", 1) for line in (ROOT / "android/version.properties").read_text().splitlines()
                  if line and not line.startswith("#"))
assert (package[2], package[3]) == (properties["VERSION_CODE"], properties["VERSION_NAME"]), \
    "APK version differs from android/version.properties"
recipe = args.metadata.read_text()
builds = re.findall(r"  - versionName: ([^\n]+)\n    versionCode: (\d+)", recipe)
assert builds, "No build entry in the recipe"
assert (builds[-1][1], builds[-1][0].strip().strip("\"'")) == (package[2], package[3]), \
    "APK version differs from the recipe's latest build"

permissions = re.findall(r"uses-permission(?:-sdk-\d+)?: name='([^']+)'", badging)
assert permissions == [], "CUUUUBE must request no permissions: %s" % permissions
gradle = (ROOT / "android/app/build.gradle.kts").read_text()
minimum = re.search(r"minSdkVersion:'(\d+)'", badging)
target = re.search(r"targetSdkVersion:'(\d+)'", badging)
assert minimum and target
assert minimum[1] == re.search(r"\bminSdk\s*=\s*(\d+)", gradle)[1], "minSdk differs from source"
assert target[1] == re.search(r"\btargetSdk\s*=\s*(\d+)", gradle)[1], "targetSdk differs from source"

web = ROOT / "web"
web_files = sorted(p.relative_to(web).as_posix() for p in web.rglob("*") if p.is_file() and p.name != ".DS_Store")
notice_records = json.loads((ROOT / "docs/FDROID_NOTICE_SOURCES.json").read_text())
with zipfile.ZipFile(args.apk) as archive:
    names = set(archive.namelist())
    assert not [n for n in names if n.endswith(".so")], "Unexpected native library"
    assert "META-INF/version-control-info.textproto" not in names, "vcsInfo must stay off"
    assert not [n for n in names if "baseline.prof" in n], "Unexpected baseline profile"
    assets = sorted(n[len("assets/"):] for n in names if n.startswith("assets/") and not n.endswith("/"))
    assert assets == web_files, "APK assets differ from web/: %s" % sorted(set(assets) ^ set(web_files))
    for relative in web_files:
        assert archive.read("assets/" + relative) == (web / relative).read_bytes(), "Asset differs: " + relative
    for record in notice_records:
        entry = "assets/" + record["file"].removeprefix("web/")
        assert hashlib.sha256(archive.read(entry)).hexdigest() == record["sha256"], "Notice differs: " + entry
    dex = b"".join(archive.read(n) for n in names if re.fullmatch(r"classes\d*\.dex", n))
    assert dex and b"Lcom/lukesteuber/cube/" in dex, "Missing app classes"
    for prefix in FORBIDDEN_DEX:
        assert prefix not in dex, "Prohibited SDK class found: " + prefix.decode()

blocks = signing_blocks(apk_bytes)
verify = subprocess.run([str(args.build_tools / "apksigner"), "verify", "--verbose", "--print-certs", str(args.apk)],
                        capture_output=True, text=True)
if args.signed_cert:
    assert verify.returncode == 0, "Signature does not verify: " + verify.stderr
    certs = re.findall(r"Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})", verify.stdout)
    assert certs == [args.signed_cert.lower()], "Unexpected signer: %s" % certs
    assert set(blocks) <= ALLOWED_BLOCKS and {"v2", "v3"} <= set(blocks), "Signing blocks: %s" % blocks
    assert re.search(r"AllowedAPKSigningKeys: %s\b" % args.signed_cert.lower(), recipe), \
        "Signer is not the recipe's AllowedAPKSigningKeys"
else:
    assert verify.returncode != 0 and blocks == [], "Expected an unsigned F-Droid build"

print(json.dumps({
    "package": package[1], "versionCode": int(package[2]), "versionName": package[3],
    "minSdk": int(minimum[1]), "targetSdk": int(target[1]), "permissions": permissions,
    "assets": len(assets), "notices": len(notice_records), "signingBlocks": blocks,
    "signed": bool(args.signed_cert), "sha256": hashlib.sha256(apk_bytes).hexdigest(),
}, indent=2))
