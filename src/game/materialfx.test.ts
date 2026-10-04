import { describe, it, expect } from 'vitest';
import { materialFx, materialName } from './materialfx';
import { P } from '../render/particles';

function setup(effects = 2, gore = true) {
  const parts: number[] = [];
  const sounds: string[] = [];
  const colors: number[][] = [];
  const handle = { color: (r: number, g: number, b: number) => { colors.push([r, g, b]); return handle; } };
  const d = {
    particle: (_x: number, _y: number, _z: number, typ: number) => { parts.push(typ); return handle as never; },
    sound: (f: string) => { sounds.push(f); },
    random: (min: number) => min, rnd: (min: number) => min,
    effects: () => effects, gore: () => gore,
  };
  return { d, parts, sounds, colors };
}

describe('materialFx', () => {
  it('chips wood with tinted smoke and effects*3 splinters', () => {
    const { d, parts, sounds, colors } = setup();
    materialFx(d, 0, 0, 0, 'wood');
    expect(parts).toEqual([P.smoke, P.wood, P.wood, P.wood, P.wood, P.wood, P.wood]);
    expect(colors[0]).toEqual([65, 50, 0]);
    expect(sounds).toEqual(['mat_wood1.wav']);
  });
  it('splatters flesh only with gore on and no particles at effect level 0', () => {
    const on = setup();
    materialFx(on.d, 0, 0, 0, 'flesh');
    expect(on.parts.filter(t => t === P.splatter).length).toBe(6);
    const off = setup(2, false);
    materialFx(off.d, 0, 0, 0, 'flesh');
    expect(off.parts).toEqual([]);
    expect(off.sounds).toEqual(['mat_flesh1.wav']);
    const none = setup(0);
    materialFx(none.d, 0, 0, 0, 'stone');
    expect(none.parts).toEqual([]);
  });
  it('reads unknown names as none and numbers as material ids', () => {
    expect(materialName('Stone ')).toBe('stone');
    expect(materialName('7')).toBe('flesh');
    expect(materialName('rubber')).toBe('none');
  });
});
