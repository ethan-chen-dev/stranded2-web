#!/usr/bin/env bash
# 下载 Stranded II 1.0.0.1 游戏本体与 Blitz3D 源码到 reference/。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p reference
if [ ! -d reference/game ]; then
  curl -L --fail -A "Mozilla/5.0" \
    -e "https://www.unrealsoftware.de/get.php?get=stranded2_en.zip" \
    "https://www.unrealsoftware.de/get.php?get=stranded2_en.zip&p=1&cid=1258" \
    -o reference/stranded2_en.zip
  unzip -q reference/stranded2_en.zip -d reference/game
  rm reference/stranded2_en.zip
fi
if [ ! -d reference/source ]; then
  git clone --depth 1 https://github.com/ttyborg/Stranded2.git reference/source
fi
echo "reference ready"
