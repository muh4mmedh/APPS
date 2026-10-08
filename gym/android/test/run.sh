#!/usr/bin/env bash
#
# run.sh — test GymDatabase.java on a computer, against real SQLite.
#
# The classes in shim/ stand in for the four Android classes it uses
# (Context, Cursor, SQLiteDatabase, SQLiteOpenHelper), backed by sqlite-jdbc
# and following Android's open/upgrade/transaction rules. The production
# GymDatabase.java is compiled unchanged. Needs a JDK and node; fetches three
# jars from Maven Central the first time.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GYM="$(cd "$HERE/../.." && pwd)"
LIBS="$HERE/../build/test-libs"
OUT="$HERE/../build/test-classes"
mkdir -p "$LIBS"
rm -rf "$OUT" && mkdir -p "$OUT"

for jar in org/xerial/sqlite-jdbc/3.46.1.3/sqlite-jdbc-3.46.1.3.jar \
           org/json/json/20240303/json-20240303.jar \
           org/slf4j/slf4j-api/2.0.13/slf4j-api-2.0.13.jar \
           org/slf4j/slf4j-nop/2.0.13/slf4j-nop-2.0.13.jar; do
  [ -f "$LIBS/$(basename "$jar")" ] || curl -sSfL -o "$LIBS/$(basename "$jar")" "https://repo.maven.apache.org/maven2/$jar"
done
CP="$(ls "$LIBS"/*.jar | tr '\n' ':')"

javac -nowarn -encoding UTF-8 -cp "$CP" -d "$OUT" \
  $(find "$HERE/shim" "$HERE/dev" -name '*.java') "$GYM/android/src/dev/apps/gym/GymDatabase.java"

LOADED="$OUT/loaded.json"
java -cp "$OUT:$CP" dev.apps.gym.GymDatabaseTest "$LOADED"

# What the database hands back must pass the page's own import checks.
node -e '
  const S = require(process.argv[1]);
  const data = S.parse(require("fs").readFileSync(process.argv[2], "utf8"));
  if (data.sessions.length !== 3 || data.unit !== "lb") throw new Error("unexpected log");
  console.log("  ok   store.js accepts what the database loads\n");
' "$GYM/js/store.js" "$LOADED"
