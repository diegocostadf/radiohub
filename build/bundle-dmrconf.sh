#!/bin/bash
# Bundles Homebrew's dmrconf (qdmr, GPL-3.0) with the Qt frameworks and other
# libraries it needs into one self-contained folder:
#   <out>/qdmr/Contents/MacOS/dmrconf
# The app ships that folder in Resources/providers, so users do not need Homebrew.
# Usage: build/bundle-dmrconf.sh pybuild/darwin-arm64/providers
set -euo pipefail
OUT="$1"
BREW="$(brew --prefix)"
SRC="$BREW/bin/dmrconf"
[ -x "$SRC" ] || { echo "dmrconf not found in $BREW/bin (brew install qdmr)"; exit 1; }
MDQ=""
for c in "$BREW/bin/macdeployqt" "$BREW"/opt/qtbase/bin/macdeployqt "$BREW"/opt/qttools/bin/macdeployqt "$BREW"/opt/qt/bin/macdeployqt; do
  if [ -x "$c" ]; then MDQ="$c"; break; fi
done
[ -n "$MDQ" ] || { echo "macdeployqt not found"; exit 1; }

WORK="$(mktemp -d)"
APP="$WORK/dmrconf.app"
mkdir -p "$APP/Contents/MacOS"
cp "$SRC" "$APP/Contents/MacOS/dmrconf"
chmod u+w "$APP/Contents/MacOS/dmrconf"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>dmrconf</string>
<key>CFBundleIdentifier</key><string>br.radiohub.dmrconf</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
PLIST

echo "== macdeployqt ($MDQ)"
"$MDQ" "$APP" -no-plugins -always-overwrite -libpath="$BREW/lib" -verbose=1

BIN="$APP/Contents/MacOS/dmrconf"
# Drop rpaths that point into Homebrew, so nothing can load from there.
for f in $(find "$APP" -type f); do
  if file "$f" | grep -q 'Mach-O'; then
    chmod u+w "$f"
    for rp in $(otool -l "$f" | awk '/LC_RPATH/{getline; getline; print $2}'); do
      case "$rp" in "$BREW"*|/usr/local*|/opt/*) install_name_tool -delete_rpath "$rp" "$f" 2>/dev/null || true ;; esac
    done
  fi
done
install_name_tool -add_rpath "@executable_path/../Frameworks" "$BIN" 2>/dev/null || true
# Each library's own install id still names its Homebrew path; point it inside the bundle.
FW="$APP/Contents/Frameworks"
for f in $(find "$FW" -type f); do
  if file "$f" | grep -q 'Mach-O'; then
    case "$(otool -D "$f" | tail -n +2)" in
      "$BREW"*|/usr/local*|/opt/*) install_name_tool -id "@executable_path/../Frameworks/${f#$FW/}" "$f" ;;
    esac
  fi
done

echo "== linkage check"
BAD=0
for f in $(find "$APP" -type f); do
  if file "$f" | grep -q 'Mach-O'; then
    if otool -L "$f" | tail -n +2 | grep -E "$BREW|/usr/local|/opt/" ; then echo "  ^ in $f"; BAD=1; fi
  fi
done
[ "$BAD" = 0 ] || { echo "Bundle still points to Homebrew"; exit 1; }

echo "== ad-hoc signing"
for f in $(find "$APP" -type f); do
  if file "$f" | grep -q 'Mach-O'; then codesign --force --sign - "$f"; fi
done
for fw in "$APP"/Contents/Frameworks/*.framework; do
  [ -d "$fw" ] && codesign --force --sign - "$fw" || true
done

mkdir -p "$OUT"
rm -rf "$OUT/qdmr"
mv "$APP" "$OUT/qdmr"
cp build/qdmr-NOTICE.txt "$OUT/qdmr/NOTICE.txt" 2>/dev/null || true
du -sh "$OUT/qdmr"
