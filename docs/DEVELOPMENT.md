# Development

English | [简体中文](DEVELOPMENT.zh-CN.md)

## Requirements

- Node.js 24 and pnpm 11
- `curl`, `unzip` and `git` for fetching the reference material

## Reference material

The original game and its source code are not part of the repository. Download them once:

```bash
./scripts/fetch-reference.sh
```

The script unpacks the official `stranded2_en.zip` into `reference/game` and clones the Blitz3D source into `reference/source`. Set `SKIP_SOURCE=1` to fetch only the game. The `reference/` directory is ignored by git.

The dev server serves `reference/game/mods/Stranded II` as its static root. Models (`.b3d`), textures, definition files (`.inf`), maps (`.s2`) and scripts (`.s2s`) are parsed in the browser in their original formats; nothing is converted offline.

## Running

```bash
pnpm install
pnpm dev
```

- `http://localhost:5173/` opens the main menu.
- `?map=maps/adventure/map02.s2` opens the map viewer with a free camera.
- Add `&mode=play` to enter the game directly on that map.

## Tests and build

```bash
pnpm test        # vitest; reads the real files under reference/game
pnpm typecheck
pnpm build       # tsc + vite; output in dist/
```

The build copies the mod directory into `dist/` and writes `dist/filelist.json`, the file index the page uses instead of the dev server's directory listing. Set `BASE_PATH=/name/` when the site is served from a sub-path.

## Project layout

| Path | Contents |
|---|---|
| `src/formats` | Parsers for `.b3d`, `.s2`, `.inf` and dialogue files; no DOM or Three.js dependencies |
| `src/assets` | URL resolution, cached resource loading, `.b3d` to Three.js conversion |
| `src/render` | Terrain, sea, sky box, world assembly |
| `src/script` | Lexer, parser, value semantics, interpreter, event engine and command implementations of the S2 scripting language |
| `src/game` | The game session and its systems: player, survival stats, AI, weapons, projectiles, crafting, building, sequences, panels, save games |
| `src/viewer` | Page entry, free camera, log panel |
| `docs/superpowers` | Design documents and implementation plans, one pair per sub-project |
| `scripts` | Reference download and deployment |

## Conventions

- Rules are ported from the original source where possible; each design document under `docs/superpowers/specs` cites the Blitz3D files it was derived from.
- Coordinates in the registry are in the original left-handed Blitz space; the scene negates `z` when placing objects.
- Time-based rules use the original per-frame factor `f = ms / 20`, converted to per-second values.

## Deployment

The playable site is GitHub Pages serving the `gh-pages` branch. Deploy from a machine that has the reference material:

```bash
scripts/deploy-pages.sh
```

The script runs the tests, builds with `BASE_PATH=/<repository>/` and force-pushes `dist/` to `gh-pages`. The build is not done in GitHub Actions because the official download rejects requests from Actions runners.
