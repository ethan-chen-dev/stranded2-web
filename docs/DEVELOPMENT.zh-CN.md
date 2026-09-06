# 开发说明

[English](DEVELOPMENT.md) | 简体中文

## 环境要求

- Node.js 24 与 pnpm 11
- 下载参考资料需要 `curl`、`unzip` 与 `git`

## 参考资料

原版游戏本体与源码不入库，先下载一次：

```bash
./scripts/fetch-reference.sh
```

脚本把官方的 `stranded2_en.zip` 解压到 `reference/game`，把 Blitz3D 源码克隆到 `reference/source`。设置 `SKIP_SOURCE=1` 只下载游戏本体。`reference/` 目录已被 git 忽略。

开发服务器以 `reference/game/mods/Stranded II` 作为静态资源根目录。模型（`.b3d`）、贴图、定义文件（`.inf`）、地图（`.s2`）与脚本（`.s2s`）都在浏览器里按原格式解析，不做离线转换。

## 运行

```bash
pnpm install
pnpm dev
```

- `http://localhost:5173/` 打开主菜单。
- `?map=maps/adventure/map02.s2` 打开带自由相机的地图查看器。
- 再加 `&mode=play` 直接在该地图进入游戏。

## 测试与构建

```bash
pnpm test        # vitest，直接读取 reference/game 下的真实文件
pnpm typecheck
pnpm build       # tsc + vite，产物在 dist/
```

构建会把 mod 目录复制进 `dist/`，并生成 `dist/filelist.json` 作为页面的文件索引，替代开发服务器的目录列表。部署到子路径时设置 `BASE_PATH=/名称/`。

## 目录结构

| 路径 | 内容 |
|---|---|
| `src/formats` | `.b3d`、`.s2`、`.inf` 与对话文件的解析器，不依赖 DOM 与 Three.js |
| `src/assets` | URL 解析、带缓存的资源加载、`.b3d` 转 Three.js |
| `src/render` | 地形、海面、天空盒、世界组装 |
| `src/script` | S2 脚本语言的词法、语法、值语义、解释器、事件引擎与指令实现 |
| `src/game` | 游戏会话及各系统：玩家、生存数值、AI、武器、投射物、合成、建造、序列、面板、存档 |
| `src/viewer` | 页面入口、自由相机、日志面板 |
| `scripts` | 参考资料下载与发布 |

## 约定

- 规则尽量按原版 Blitz3D 源码移植；各模块的文件头注释注明了依据的源码文件。
- 实体注册表使用原版的左手系 Blitz 坐标，放入场景时 `z` 取负。
- 与时间相关的规则沿用原版的每帧因子 `f = 毫秒 / 20`，换算为每秒的值。

## 发布

试玩站点是 GitHub Pages，托管 `gh-pages` 分支。在有参考资料的机器上执行：

```bash
scripts/deploy-pages.sh
```

脚本会运行测试，以 `BASE_PATH=/<仓库名>/` 构建，并把 `dist/` 强推到 `gh-pages`。不在 GitHub Actions 里构建，因为官方下载链接拒绝来自 Actions 机器的请求。
