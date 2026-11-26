#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
package_dir="$(mktemp -d)"
trap 'rm -rf -- "$package_dir"' EXIT

archive="$(npm pack --pack-destination "$package_dir" --silent)"
tar -xf "$package_dir/$archive" -C "$package_dir"
cd "$package_dir/package"

printf 'metric,value\nsample_count,12\n' > sample.csv
node scripts/render-diagrams.mjs --from-files sample.csv -o sample.diagram.json
node scripts/validate-diagrams.mjs sample.diagram.json
node scripts/render-diagrams.mjs --html sample.diagram.json -o sample.html
node --input-type=module -e '
  import assert from "node:assert/strict"
  import { readFileSync } from "node:fs"
  const html = readFileSync("sample.html", "utf8")
  assert.match(html, /<!doctype html>/i)
  assert.match(html, /sample\.csv/)
'
echo '发布包解释图流程通过。'
