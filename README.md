# Stranded

Stranded II（Unreal Software，2007，Blitz3D）的浏览器复刻，TypeScript + Three.js，目标是忠实还原原版。

## 现状

- 子项目 1 地图查看器：在浏览器里加载原版地图，渲染地形、海面、天空盒和地图上的全部物体、单位、物品，动物播放待机动画。
- 子项目 2 玩家与世界循环：第一人称行走、跳跃、游泳、与物体碰撞；游戏时间推进并按原版 `lightcycle.inf` 驱动天空、环境光与雾；饥饿、口渴、疲劳随活动上升，满值扣血；拾取物品进背包，背包可查看与丢弃。

后续子项目：脚本解释器、物品使用与合成建造、单位 AI、战役与序列、随机岛与编辑器。

## 准备参考资料

原版游戏本体与源码不入库，运行前先下载：

```bash
./scripts/fetch-reference.sh
```

脚本会把游戏本体解压到 `reference/game`，把 Blitz3D 源码克隆到 `reference/source`。开发服务器直接以 `reference/game/mods/Stranded II` 作为静态资源根目录，模型、贴图、定义文件、地图都在运行时按原格式读取，不做离线转换。

## 运行

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:5173/?map=maps/adventure/map02.s2`。页面左上角可切换地图，拖拽鼠标转视角，WASD 移动，QE 升降，Shift 加速。

点击"进入游戏"或在 URL 加 `&mode=play` 进入游戏模式：鼠标转视角（指针锁定），WASD 移动，空格跳跃，E 或鼠标左键拾取准星前的物品，Tab 开关背包。右下角显示游戏时间，1 游戏分钟为 0.5 秒实时。

## 测试与构建

```bash
pnpm test
pnpm typecheck
pnpm build
```

单元测试直接读取 `reference/game` 里的真实文件（全部地图、全部 321 个模型、全部定义文件）。

## 目录

- `src/formats`：b3d、s2、inf 解析器，不依赖 DOM 与 Three.js
- `src/assets`：路径解析、带缓存的资源加载、b3d 转 Three.js
- `src/render`：地形、海面、天空盒、世界组装
- `src/game`：时钟、光照表、玩家物理、碰撞、生存数值、背包、拾取、HUD、会话
- `src/viewer`：页面入口、相机、日志
- `docs/superpowers`：设计文档与实现计划

## 许可

本仓库代码按 CC BY-NC-SA 3.0 DE 使用 Stranded II 源码中的规则与数据结构，仅限非商业用途。游戏素材（模型、贴图、音效、地图）版权归 Peter Schauß / Unreal Software，仅供个人非商业研究使用，不随仓库分发。
