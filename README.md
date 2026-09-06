# Stranded II 浏览器复刻

用 TypeScript + Three.js 在浏览器里重现 Unreal Software 2007 年的荒岛生存游戏 Stranded II。直接读取原版的模型、贴图、地图和脚本，目标是忠实还原原版规则。

试玩地址：https://ethanchen-ai.github.io/stranded2-web/

## 试玩说明

目前是 alpha 版本，冒险战役 map01 到 map07 可以连续游玩，支持存档读档。只支持桌面浏览器（Chrome、Edge、Firefox），需要鼠标指针锁定，手机不支持。

操作：

| 按键 | 作用 |
|---|---|
| 鼠标 | 转视角（点击画面锁定指针） |
| W A S D、空格 | 移动、跳跃 |
| 左键 | 攻击（徒手或手持武器、弓、投掷） |
| 右键 | 用手持工具：锤子建造、铲子挖掘、鱼竿钓鱼；徒手时等于使用 |
| E | 拾取、使用、和人对话、搜刮尸体、打开箱子 |
| Tab | 背包（多选后可合成，物品可手持、使用、丢弃） |
| B | 建筑菜单 |
| T | 日记与技能 |
| Esc | 暂停菜单（保存、读取）；过场序列中跳过 |
| F5 / F9 | 快速存档、快速读档 |

存档保存在浏览器的 localStorage 里，清除站点数据会丢失。

已知空缺：载具不能驾驭、对话里的交易界面没有、没有粒子特效、随机岛与地图编辑器没做。遇到问题请开 Issue，附上地图名和复现步骤。

## 本地开发

原版游戏本体与源码不入库，先下载：

```bash
./scripts/fetch-reference.sh
```

脚本把游戏本体解压到 `reference/game`，把 Blitz3D 源码克隆到 `reference/source`。开发服务器直接以 `reference/game/mods/Stranded II` 作为静态资源根目录，所有资源在运行时按原格式读取，不做离线转换。

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:5173/` 进入主菜单；`?map=maps/adventure/map02.s2` 打开地图查看器，再加 `&mode=play` 直接进入游戏。

```bash
pnpm test
pnpm typecheck
pnpm build
```

单元测试直接读取 `reference/game` 里的真实文件（全部地图、全部模型、全部定义文件）。`pnpm build` 会把 mod 目录打进产物并生成 `filelist.json` 供静态托管使用；部署到子路径时设置 `BASE_PATH=/仓库名/`。

发布到 GitHub Pages 在本机执行 `scripts/deploy-pages.sh`：构建后把 `dist` 强推到 `gh-pages` 分支。官网的下载链接会拦截 GitHub Actions 的机器，所以不在 CI 里构建。

## 实现范围

- 地图查看器：地形、海面、天空盒、全部物体、单位、物品，动画播放。
- 玩家与世界循环：第一人称移动、跳跃、游泳、碰撞；昼夜光照与雾；饥饿、口渴、疲劳；拾取与背包。
- 脚本解释器：原版 S2 脚本语言的完整解释器，事件、任务队列、局部变量、状态、定时器；约 270 条指令。
- 物品、合成、建造：近战、远程、火器与投掷武器，`find`/`loot` 掉落，背包合成，建筑菜单与工地投料，挖掘与钓鱼。
- 单位 AI：原版行为状态机，游荡、逃跑、追击、攻击、受击反应、驯养、觅食、AI 信号，陆地、水中、空中物理。
- 战役与序列：主菜单与暂停菜单，过场序列与镜头，地图切换与数据继承，消息框、对话、日记、界面文字图片，存档读档。
- 战役收尾：技能、单位路径、触发器信息点、容器交换、日记扩展、定义脚本覆盖、音乐。

## 目录

- `src/formats`：b3d、s2、inf、对话文件解析器
- `src/assets`：路径解析、带缓存的资源加载、b3d 转 Three.js
- `src/render`：地形、海面、天空盒、世界组装
- `src/script`：脚本词法、语法、值语义、解释器、事件引擎、指令实现
- `src/game`：会话与各游戏系统（玩家、AI、武器、建造、序列、面板、存档等）
- `src/viewer`：页面入口、相机、日志
- `docs/superpowers`：设计文档与实现计划
- `scripts/deploy-pages.sh`：本机构建并发布到 GitHub Pages

## 许可与致谢

Stranded II 由 Peter Schauß / Unreal Software 制作，官网 https://www.unrealsoftware.de 。原版源码按 CC BY-NC-SA 3.0 DE 公开，本仓库的代码是其移植改编，同样按 CC BY-NC-SA 3.0 DE 发布，仅限非商业用途，详见 `LICENSE`。

游戏素材（模型、贴图、音效、音乐、地图、定义文件）版权归 Peter Schauß / Unreal Software，不随仓库分发；试玩站点在构建时从官网下载并随页面一起托管，只用于这个非商业的复刻。
