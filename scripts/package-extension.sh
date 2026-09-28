#!/usr/bin/env bash
# Gera javis-extension-<versao>.zip na raiz do projeto, pronto para
# "Carregar sem compactação" ou para o upload na Chrome Web Store.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./extension/manifest.json').version")
OUT="javis-extension-${VERSION}.zip"
rm -f "$OUT"
(cd extension && zip -qr "../$OUT" .)
echo "pacote criado: $OUT ($(du -h "$OUT" | cut -f1))"
