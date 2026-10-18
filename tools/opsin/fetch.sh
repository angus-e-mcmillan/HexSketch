#!/bin/sh
# Fetch OPSIN (MIT licence, https://github.com/dan2097/opsin), used locally to
# verify generated names by parsing them back to structures. Nothing is sent
# anywhere at run time; this only downloads the jar once.
set -e
cd "$(dirname "$0")"
VERSION=2.9.0
JAR="opsin-cli-$VERSION-jar-with-dependencies.jar"
[ -f opsin.jar ] && exit 0
curl -fsSL -o opsin.jar "https://github.com/dan2097/opsin/releases/download/$VERSION/$JAR"
echo "OPSIN $VERSION -> $(pwd)/opsin.jar"
