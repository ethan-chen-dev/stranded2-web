/**
 * 玩家设置（原版 sys/settings.cfg 与 controls.cfg 的对应项），存在浏览器本地；读不到时用缺省值。
 * 缺省值取原版自带 settings.cfg：特效档 2、草地档 1、随风摆动开、雾开、动态模糊开 0.12、音乐与音效满音量；
 * 视距缺省为最远档（原版自带为中档，这里保留更开阔的视野）。
 */
export const VIEW_FACTORS = [0.5, 1, 1.5, 2.5, 4];

export type Action =
  | 'forward' | 'backward' | 'left' | 'right' | 'jump' | 'sleep' | 'attack1' | 'attack2' | 'use'
  | 'inventory' | 'diary' | 'build' | 'quicksave' | 'quickload';

export const ACTIONS: { action: Action; label: string }[] = [
  { action: 'forward', label: 'Forward' }, { action: 'backward', label: 'Backward' },
  { action: 'left', label: 'Left' }, { action: 'right', label: 'Right' },
  { action: 'jump', label: 'Jump' }, { action: 'sleep', label: 'Sleep' },
  { action: 'attack1', label: 'Attack 1' }, { action: 'attack2', label: 'Attack 2' },
  { action: 'use', label: 'Use' }, { action: 'inventory', label: 'Rucksack' },
  { action: 'diary', label: 'Diary' }, { action: 'build', label: 'Build' },
  { action: 'quicksave', label: 'Quick Save' }, { action: 'quickload', label: 'Quick Load' },
];

export interface Settings {
  /** 视距档 0..4，系数见 VIEW_FACTORS。 */
  viewRange: number;
  effects: number;
  grass: number;
  windsway: boolean;
  fog: boolean;
  gore: boolean;
  motionBlur: boolean;
  motionBlurAlpha: number;
  musicVolume: number;
  sfxVolume: number;
  mouseSensitivity: number;
  invertMouse: boolean;
  /** 每个动作一个按键（KeyboardEvent.code 或 Mouse0/Mouse2）。 */
  keys: Record<Action, string>;
}

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sleep: 'KeyY',
  attack1: 'Mouse0', attack2: 'Mouse2', use: 'KeyE', inventory: 'Tab', diary: 'KeyT', build: 'KeyB',
  quicksave: 'F5', quickload: 'F9',
};

export function defaultSettings(): Settings {
  return {
    viewRange: 4, effects: 2, grass: 1, windsway: true, fog: true, gore: true, motionBlur: true, motionBlurAlpha: 0.12,
    musicVolume: 1, sfxVolume: 1, mouseSensitivity: 1, invertMouse: false, keys: { ...DEFAULT_KEYS },
  };
}

const STORAGE_KEY = 'stranded2-settings';

export function loadSettings(): Settings {
  const s = defaultSettings();
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return s;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return { ...s, ...saved, keys: { ...s.keys, ...(saved.keys ?? {}) } };
  } catch {
    return s;
  }
}

export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等存不了时只在本次生效 */
  }
}

export function viewFactor(s: Settings): number {
  return VIEW_FACTORS[Math.max(0, Math.min(4, Math.trunc(s.viewRange)))];
}

/** 按键在界面上的名字。 */
export function keyLabel(code: string): string {
  if (code === 'Mouse0') return 'Left mouse';
  if (code === 'Mouse2') return 'Right mouse';
  if (code === 'Mouse1') return 'Middle mouse';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
