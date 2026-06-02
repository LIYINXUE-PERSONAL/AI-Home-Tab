#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${ROOT_DIR}/manifest.json', 'utf8')).version)")"
DIST_DIR="${ROOT_DIR}/dist"
PACKAGE_NAME="ai-new-tab-${VERSION}.zip"

mkdir -p "${DIST_DIR}"
rm -f "${DIST_DIR}/${PACKAGE_NAME}"

cd "${ROOT_DIR}"
zip -r "${DIST_DIR}/${PACKAGE_NAME}" \
  manifest.json \
  newtab.html \
  src \
  assets

echo "${DIST_DIR}/${PACKAGE_NAME}"
