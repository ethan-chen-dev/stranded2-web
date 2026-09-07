#!/usr/bin/env bash
# 本地构建并把 dist 推到 gh-pages 分支（GitHub Pages 源）。官网下载被 CI 机器拦截，所以在本机部署。
# 用法：scripts/deploy-pages.sh [仓库名]，缺省从 origin 推断；站点路径为 /<仓库名>/。
set -euo pipefail
cd "$(dirname "$0")/.."
remote=$(git remote get-url origin)
repo=${1:-$(basename -s .git "$remote")}
[ -d reference/game ] || ./scripts/fetch-reference.sh
pnpm test
rm -rf dist
BASE_PATH="/$repo/" pnpm build
touch dist/.nojekyll
cp LICENSE dist/LICENSE.txt
cp README.md dist/README.md
cp ASSETS-LICENSE.txt dist/ASSETS-LICENSE.txt
(
  cd dist
  git init -q
  git checkout -q -b gh-pages
  git add -A
  git -c user.name="$(git -C .. config user.name || echo deploy)" -c user.email="$(git -C .. config user.email || echo deploy@localhost)" commit -qm "deploy $(git -C .. rev-parse --short HEAD)"
  git push -q --force "$remote" gh-pages
)
echo "pushed gh-pages; site: https://$(echo "$remote" | sed -E 's#.*github.com[:/]([^/]+)/.*#\1#').github.io/$repo/"
