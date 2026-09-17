#!/usr/bin/env bash
#
# new-app.sh — scaffold a new app and register it on the home page.
#
#   tools/new-app.sh <id> "<Name>" ["<tagline>"]
#
# Example:
#   tools/new-app.sh unit-converter "Unit Converter" "Convert anything to anything."
#
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

id="${1:-}"
name="${2:-}"
tagline="${3:-A new app.}"

if [[ -z "$id" || -z "$name" ]]; then
  echo "usage: tools/new-app.sh <id> \"<Name>\" [\"<tagline>\"]" >&2
  exit 64
fi

if [[ ! "$id" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "error: id must be lowercase letters, digits and dashes (got '$id')" >&2
  exit 64
fi

target="$root/apps/$id"
if [[ -e "$target" ]]; then
  echo "error: apps/$id already exists" >&2
  exit 1
fi

cp -R "$root/apps/_template" "$target"
rm -f "$target/README.md"

# Fill the placeholders. Escape anything meaningful to sed's replacement.
esc() { printf '%s' "$1" | sed -e 's/[&/\]/\\&/g'; }
sed -i.bak -e "s/APP_NAME/$(esc "$name")/g" -e "s/APP_TAGLINE/$(esc "$tagline")/g" \
  "$target/index.html"
rm -f "$target/index.html.bak"

registry="$root/assets/js/registry.js"
today="$(date +%Y-%m-%d)"

# Insert a new entry at the top of the window.APPS array.
python3 - "$registry" "$id" "$name" "$tagline" "$today" <<'PY'
import sys, re
path, app_id, name, tagline, today = sys.argv[1:6]
source = open(path).read()
marker = 'window.APPS = ['
at = source.index(marker) + len(marker)


def js(text):
    return "'" + text.replace('\\', '\\\\').replace("'", "\\'") + "'"


entry = (
    "\n  {\n"
    "    id: %s,\n"
    "    name: %s,\n"
    "    tagline: %s,\n"
    "    icon: '◇',\n"
    "    accent: '#6f5cf6',\n"
    "    tags: [],\n"
    "    status: 'wip',\n"
    "    added: %s\n"
    "  },"
) % (js(app_id), js(name), js(tagline), js(today))

open(path, 'w').write(source[:at] + entry + source[at:])
PY

echo "created apps/$id and registered it in assets/js/registry.js"
echo
echo "next:"
echo "  python3 -m http.server 8000     # then open http://localhost:8000/apps/$id/"
