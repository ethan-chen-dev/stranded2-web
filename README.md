# Stranded II Web

English | [简体中文](README.zh-CN.md)

A faithful browser remake of *Stranded II*, the 2007 island survival game by Unreal Software, written in TypeScript with Three.js. The original models, textures, maps and scripts are loaded at runtime, and the game rules are ported from the published Blitz3D source, so the adventure plays the way it did in 2007.

**Play it:** https://ethan-chen-dev.github.io/stranded2-web/

![Stranded II Web](docs/screenshot.jpg)

## Features

- The full adventure campaign, map01 to map07, including the intro sequence, dialogues, diary and map transitions.
- The original survival loop: hunger, thirst and exhaustion, day and night cycle driven by the original light table.
- Items, crafting, building, digging and fishing driven by the original definition files and the S2 scripting language (about 270 script commands implemented).
- Animal AI ported from the original state machine: wandering, fleeing, hunting, attacking, taming and feeding.
- Melee, ranged, firearm and thrown weapons with projectiles.
- Save and load, quick save (F5) and quick load (F9); saves live in the browser's local storage.

## Controls

| Key | Action |
|---|---|
| Mouse | Look around (click the view to lock the pointer) |
| W A S D, Space | Move, jump |
| Left button | Attack with hands, the held weapon, a bow or a thrown item |
| Right button | Use the held tool: hammer builds, spade digs, fishing rod fishes; bare-handed it equals Use |
| E | Pick up, use, talk, loot a corpse, open a container |
| Tab | Inventory: select several items to combine; hold, use or drop items |
| B | Building menu |
| T | Diary and skills |
| Esc | Pause menu with save and load; skips a cutscene |
| F5 / F9 | Quick save, quick load |

## Status

This is an alpha. Desktop browsers only (Chrome, Edge, Firefox); pointer lock is required, so phones and tablets are not supported.

Not implemented yet: driving vehicles, the trade tab in dialogues, particle effects, the random island generator and the map editor.

Bug reports are welcome as GitHub issues; please include the map name and the steps to reproduce.

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for setup, tests, build, project layout and deployment.

## License and credits

*Stranded II* was created by Peter Schauß / Unreal Software, https://www.unrealsoftware.de. Its source code was released under CC BY-NC-SA 3.0 DE; this remake is a derived work released under the same license for non-commercial use only. See [LICENSE](LICENSE).

The game assets (models, textures, sounds, music, maps and definition files) remain the property of Peter Schauß / Unreal Software. They are not part of this repository; the playable site fetches them from the official download at build time solely to run this non-commercial remake.
