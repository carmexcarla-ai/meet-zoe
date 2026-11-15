#!/bin/sh
# Augmente d'une unité le numéro « ?v=… » placé après les fichiers CSS et
# JavaScript dans toutes les pages. À lancer avant chaque mise en ligne :
#   sh outils/version.sh
# Sans cela, le navigateur des visiteurs peut garder d'anciens scripts.
set -e
cd "$(dirname "$0")/.."
actuel=$(grep -oh '?v=[0-9]*' *.html | sort -u | sed 's/?v=//')
if [ "$(echo "$actuel" | wc -l)" != "1" ]; then
  echo "Les pages n'ont pas toutes le même numéro : $actuel" >&2; exit 1
fi
nouveau=$((actuel + 1))
sed -i "s/?v=$actuel\"/?v=$nouveau\"/g" *.html
echo "Version $actuel -> $nouveau dans $(grep -l "?v=$nouveau" *.html | wc -l) pages."
