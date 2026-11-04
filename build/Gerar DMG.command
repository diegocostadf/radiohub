#!/bin/bash
# RadioHub · gera o instalador DMG a partir do RadioHub.app desta pasta.
# Usa só ferramentas da Apple (codesign e hdiutil). Dê dois cliques para rodar.
set -euo pipefail
cd "$(dirname "$0")"

APP="RadioHub.app"
if [ ! -d "$APP" ]; then
  echo "Não achei o $APP nesta pasta. Descompacte o RadioHub-mac-arm64.zip aqui primeiro."
  read -r -p "Pressione Enter para fechar." _; exit 1
fi

VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist")
DMG="RadioHub-mac-arm64.dmg"
echo "RadioHub $VERSION"
echo "1/4 Limpando atributos de download…"
xattr -cr "$APP"

echo "2/4 Assinando (assinatura local, sem conta Apple)…"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "    assinatura ok"

echo "3/4 Montando o instalador…"
STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Aplicativos"
[ -f "LEIA-ME.txt" ] && cp "LEIA-ME.txt" "$STAGE/"
rm -f "$DMG"
hdiutil create -volname "RadioHub $VERSION" -srcfolder "$STAGE" -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$DMG" >/dev/null
rm -rf "$STAGE"

echo "4/4 Conferindo…"
hdiutil verify "$DMG" >/dev/null && echo "    DMG ok"
SIZE=$(du -h "$DMG" | cut -f1)
SHA=$(shasum -a 256 "$DMG" | cut -d' ' -f1)
printf '{"version":"%s","file":"%s","sha256":"%s"}\n' "$VERSION" "$DMG" "$SHA" > release.json

echo
echo "Pronto: $DMG ($SIZE)"
echo "Versão $VERSION · SHA-256 $SHA"
open -R "$DMG"
read -r -p "Pressione Enter para fechar." _
