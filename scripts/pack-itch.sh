#!/usr/bin/env bash
# 打包成 itch.io 的 HTML5 游戏 zip：index.html 在压缩包根目录，全部路径相对，
# 因为 itch 把游戏放在随机子路径的沙箱 iframe 里。
# 用法：scripts/pack-itch.sh [输出文件]
set -euo pipefail
cd "$(dirname "$0")/.."
out=${1:-stranded2-web-itch.zip}
[ -d reference/game ] || ./scripts/fetch-reference.sh
pnpm test
rm -rf dist
BASE_PATH=./ pnpm build
cp LICENSE dist/LICENSE.txt
cp README.md dist/README.md
cp ASSETS-LICENSE.txt dist/ASSETS-LICENSE.txt
rm -f "$out"
(cd dist && zip -qr "../$out" . -x '.*')
echo "$out  $(du -h "$out" | cut -f1)"
