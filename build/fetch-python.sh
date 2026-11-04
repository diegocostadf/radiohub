#!/bin/bash
# Downloads and trims the standalone Python runtimes bundled with RadioHub.
# Works with macOS's bash 3.2 (no associative arrays).
set -euo pipefail
cd "$(dirname "$0")/.."
TAG=20250818; VER=3.12.11
for pair in darwin-arm64:aarch64-apple-darwin darwin-x64:x86_64-apple-darwin win32-x64:x86_64-pc-windows-msvc win32-ia32:i686-pc-windows-msvc; do
  k=${pair%%:*}; t=${pair#*:}
  rm -rf "pybuild/$k"; mkdir -p "pybuild/$k"
  curl -fsSL "https://github.com/astral-sh/python-build-standalone/releases/download/$TAG/cpython-$VER+$TAG-$t-install_only.tar.gz" | tar xz -C "pybuild/$k"
  d="pybuild/$k/python"
  rm -rf "$d"/lib/python3.12/test "$d"/lib/python3.12/idlelib "$d"/lib/python3.12/tkinter "$d"/lib/python3.12/ensurepip \
         "$d"/lib/python3.12/lib2to3 "$d"/lib/python3.12/pydoc_data "$d"/lib/python3.12/config-3.12-darwin "$d"/lib/python3.12/site-packages/pip* \
         "$d"/Lib/test "$d"/Lib/idlelib "$d"/Lib/tkinter "$d"/Lib/ensurepip "$d"/Lib/lib2to3 "$d"/Lib/pydoc_data "$d"/Lib/site-packages/pip* \
         "$d"/include "$d"/share "$d"/tcl "$d"/libs "$d"/Scripts "$d"/lib/tcl* "$d"/lib/tk* || true
  find "$d" \( -name "*.pdb" -o -name "__pycache__" \) -prune -exec rm -rf {} + || true
  echo "$k: $(du -sh "$d" | cut -f1)"
done
