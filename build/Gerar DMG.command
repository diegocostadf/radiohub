#!/bin/bash
# RadioHub · gera os instaladores DMG do Mac (Apple Silicon e Intel).
# Procura RadioHub.app nas pastas mac-arm64 e mac-x64 ao lado deste arquivo
# (ou um RadioHub.app solto, tratado pela arquitetura do próprio app).
# Usa só ferramentas da Apple (codesign e hdiutil). Dê dois cliques para rodar.
set -euo pipefail
cd "$(dirname "$0")"

build_dmg() { # $1 = pasta do .app, $2 = arch (arm64|x64)
  local APP="$1/RadioHub.app" ARCH="$2"
  local VERSION DMG STAGE SIZE SHA
  VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist")
  DMG="RadioHub-mac-$ARCH.dmg"
  echo
  echo "== RadioHub $VERSION · Mac $ARCH =="
  echo "1/4 Limpando atributos de download…"
  xattr -cr "$APP"
  echo "2/4 Assinando (assinatura local, sem conta Apple)…"
  codesign --force --deep --sign - "$APP"
  codesign --verify --deep --strict "$APP" && echo "    assinatura ok"
  echo "3/4 Montando o instalador…"
  STAGE=$(mktemp -d)
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Aplicativos"
  rm -f "$DMG"
  hdiutil create -volname "RadioHub $VERSION" -srcfolder "$STAGE" -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$DMG" >/dev/null
  rm -rf "$STAGE"
  echo "4/4 Conferindo…"
  hdiutil verify "$DMG" >/dev/null && echo "    DMG ok"
  SIZE=$(du -h "$DMG" | cut -f1)
  SHA=$(shasum -a 256 "$DMG" | cut -d' ' -f1)
  echo "    $DMG ($SIZE) · SHA-256 $SHA"
  echo "{\"version\":\"$VERSION\",\"file\":\"$DMG\",\"sha256\":\"$SHA\"}" > "release-mac-$ARCH.json"
}

FOUND=0
for ARCH in arm64 x64; do
  if [ -d "mac-$ARCH/RadioHub.app" ]; then build_dmg "mac-$ARCH" "$ARCH"; FOUND=1; fi
done
if [ $FOUND = 0 ] && [ -d "RadioHub.app" ]; then
  BIN="RadioHub.app/Contents/MacOS/RadioHub"
  if file "$BIN" | grep -q arm64; then build_dmg "." arm64; else build_dmg "." x64; fi
  FOUND=1
fi
if [ $FOUND = 0 ]; then
  echo "Não achei nenhum RadioHub.app (pastas mac-arm64, mac-x64 ou solto nesta pasta)."
  read -r -p "Pressione Enter para fechar." _; exit 1
fi

echo
echo "Pronto. Os DMGs estão nesta pasta."
open .
read -r -p "Pressione Enter para fechar." _
