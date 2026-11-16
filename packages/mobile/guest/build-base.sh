#!/bin/sh
# Builds the guest runtime's assets into <out>/guest/: base.hbc (guest/base.ts with Metro, then Hermes bytecode with the
# hermesc that matches this app's Hermes) and base.json (its sha256; ensureBase copies the base again when it changes).
# A build with EXPO_PUBLIC_LOPHN_GUEST_LAB=1 also gets the lab's fixture screens (guest/build-fixtures.ts).
# The gradle build runs this (plugins/with-guest-runtime.js); by hand: sh guest/build-base.sh <out>.
set -eu
out="$1/guest"
work="$1-work"
cd "$(dirname "$0")/.."
rm -rf "$out" "$work"
mkdir -p "$out" "$work"
# The base's module registry is typed against PHONE_HOST_MODULES; a mismatch fails here.
npx tsc --noEmit
LOPHN_GUEST_BASE=1 CI=1 npx expo export:embed --platform android --dev false --minify true \
  --entry-file guest/base.ts --bundle-output "$work/base.js" --assets-dest "$work/assets" --reset-cache
hermes=$(node --print "require('node:path').dirname(require.resolve('hermes-compiler/package.json', { paths: [require.resolve('react-native/package.json')] }))")
"$hermes/hermesc/linux64-bin/hermesc" -emit-binary -O -w -out "$out/base.hbc" "$work/base.js"
node -e "const b=require('node:fs').readFileSync(process.argv[1]);console.log(JSON.stringify({sha256:require('node:crypto').createHash('sha256').update(b).digest('hex'),size:b.length}))" "$out/base.hbc" > "$out/base.json"
if [ "${EXPO_PUBLIC_LOPHN_GUEST_LAB:-}" = "1" ]; then
  node guest/build-fixtures.ts "$out/fixtures" "$work/fixtures"
fi
