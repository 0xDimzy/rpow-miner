#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

cc_bin="${CC:-cc}"

if ! command -v "$cc_bin" >/dev/null 2>&1; then
  echo "C compiler not found: $cc_bin" >&2
  echo "Ubuntu/Debian: sudo apt install build-essential" >&2
  exit 1
fi

"$cc_bin" \
  -O3 \
  -march=native \
  -pthread \
  rpow-native-miner.c \
  -o rpow-native-miner \
  -lcrypto
  
chmod +x rpow-native-miner

echo "Built ./rpow-native-miner"
echo "Run:"
echo "node rpow-cli.js mine --count 1 --engine native"
