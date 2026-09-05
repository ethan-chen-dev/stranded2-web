/** Stranded II 地图文件（.s2）解析，顺序与原版 e_load_map.bb 一致。 */
import { BinaryReader } from './binary-reader';

export interface MapHeader {
  version: string;
  date: string;
  time: string;
  format: string;
  mode: string;
  day: number;
  hour: number;
  minute: number;
  freezeTime: boolean;
  skybox: string;
  multiplayer: boolean;
  climate: number;
  music: string;
  briefing: string;
  fog: [number, number, number, number];
  quickslots: string[];
}

export interface MapObject {
  id: number; typ: number; x: number; z: number; yaw: number;
  health: number; healthMax: number; dayTimer: number;
}

export interface MapUnit {
  id: number; typ: number; x: number; y: number; z: number; yaw: number;
  health: number; healthMax: number; hunger: number; thirst: number; exhaustion: number;
  aiCx: number; aiCz: number;
}

export interface MapItem {
  id: number; typ: number; x: number; y: number; z: number; yaw: number;
  health: number; count: number; parentClass: number; parentMode: number; parentId: number;
}

export interface MapInfo {
  id: number; typ: number; x: number; y: number; z: number; pitch: number; yaw: number; vars: string;
}

export interface MapState {
  typ: number; parentClass: number; parentId: number;
  x: number; y: number; z: number; fx: number; fy: number; fz: number;
  value: number; valueF: number; valueS: string;
}

/** 扩展记录：mode 0 实例脚本、1 全局变量、3 建筑锁、4 实体局部变量、5 技能。 */
export interface MapExtension {
  typ: number; parentClass: number; parentId: number; mode: number;
  key: string; value: string; stuff: string;
}

export interface MapData {
  header: MapHeader;
  /** 96x72 RGB 预览图。 */
  preview: Uint8Array;
  colormapSize: number;
  /** size*size RGB，索引 (x*size+y)*3。 */
  colormap: Uint8Array;
  terrainSize: number;
  /** (n+1)^2 个 0..1 高度，索引 x*(n+1)+y。 */
  heights: Float32Array;
  /** (colormapSize+1)^2 个草地标记。 */
  grass: Uint8Array;
  objects: MapObject[];
  units: MapUnit[];
  items: MapItem[];
  infos: MapInfo[];
  states: MapState[];
  extensions: MapExtension[];
}

export const PREVIEW_W = 96;
export const PREVIEW_H = 72;

export function parseS2Map(bytes: Uint8Array): MapData {
  const r = new BinaryReader(bytes);

  const magic = r.line();
  if (!magic.startsWith('### Stranded II')) throw new Error('Invalid Map (Invalid Header)');
  const version = r.line();
  const date = r.line();
  const time = r.line();
  const format = r.line();
  const mode = r.line();
  const typeFormat = r.line();
  const wideTyp = (i: number) => typeFormat.length > i && typeFormat[i] !== '0';
  const readTyp = (wide: boolean) => (wide ? r.u16() : r.u8());
  for (let i = 0; i < 5; i++) r.line();

  const preview = new Uint8Array(r.bytes(PREVIEW_W * PREVIEW_H * 3));

  r.u8();
  r.line();

  const day = r.i32();
  const hour = r.u8();
  const minute = r.u8();
  const freezeTime = r.u8() !== 0;
  const skybox = r.bstring();
  const multiplayer = r.u8() !== 0;
  const climate = r.u8();
  const music = r.bstring();
  const briefing = r.bstring();
  const fog: [number, number, number, number] = [r.u8(), r.u8(), r.u8(), r.u8()];
  r.u8();
  const quickslots: string[] = [];
  for (let i = 0; i < 10; i++) quickslots.push(r.bstring());

  const colormapSize = r.i32();
  const colormap = new Uint8Array(r.bytes(colormapSize * colormapSize * 3));

  let terrainSize = r.i32();
  if (terrainSize < 0) terrainSize = 32;
  const n1 = terrainSize + 1;
  const heights = new Float32Array(n1 * n1);
  for (let x = 0; x < n1; x++) {
    for (let y = 0; y < n1; y++) heights[x * n1 + y] = r.f32();
  }

  const grass = new Uint8Array(r.bytes((colormapSize + 1) * (colormapSize + 1)));

  const objects: MapObject[] = [];
  let count = r.i32();
  for (let i = 0; i < count; i++) {
    objects.push({
      id: r.i32(), typ: readTyp(wideTyp(0)), x: r.f32(), z: r.f32(), yaw: r.f32(),
      health: r.f32(), healthMax: r.f32(), dayTimer: r.i32(),
    });
  }

  const units: MapUnit[] = [];
  count = r.i32();
  for (let i = 0; i < count; i++) {
    units.push({
      id: r.i32(), typ: readTyp(wideTyp(1)), x: r.f32(), y: r.f32(), z: r.f32(), yaw: r.f32(),
      health: r.f32(), healthMax: r.f32(), hunger: r.f32(), thirst: r.f32(), exhaustion: r.f32(),
      aiCx: r.f32(), aiCz: r.f32(),
    });
  }

  const items: MapItem[] = [];
  count = r.i32();
  for (let i = 0; i < count; i++) {
    items.push({
      id: r.i32(), typ: readTyp(wideTyp(2)), x: r.f32(), y: r.f32(), z: r.f32(), yaw: r.f32(),
      health: r.f32(), count: r.i32(), parentClass: r.u8(), parentMode: r.u8(), parentId: r.i32(),
    });
  }

  const infos: MapInfo[] = [];
  count = r.i32();
  for (let i = 0; i < count; i++) {
    infos.push({
      id: r.i32(), typ: r.u8(), x: r.f32(), y: r.f32(), z: r.f32(), pitch: r.f32(), yaw: r.f32(),
      vars: r.bstring(),
    });
  }

  const states: MapState[] = [];
  const extensions: MapExtension[] = [];
  if (!r.eof()) {
    count = r.i32();
    for (let i = 0; i < count; i++) {
      states.push({
        typ: r.u8(), parentClass: r.u8(), parentId: r.i32(),
        x: r.f32(), y: r.f32(), z: r.f32(), fx: r.f32(), fy: r.f32(), fz: r.f32(),
        value: r.i32(), valueF: r.f32(), valueS: r.bstring(),
      });
    }
  }
  if (!r.eof()) {
    count = r.i32();
    for (let i = 0; i < count; i++) {
      extensions.push({
        typ: r.u8(), parentClass: r.u8(), parentId: r.i32(), mode: r.i32(),
        key: r.bstring(), value: r.bstring(), stuff: r.bstring(),
      });
    }
  }

  return {
    header: {
      version, date, time, format, mode, day, hour, minute, freezeTime, skybox, multiplayer,
      climate, music, briefing, fog, quickslots,
    },
    preview, colormapSize, colormap, terrainSize, heights, grass, objects, units, items, infos, states, extensions,
  };
}
