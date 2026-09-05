import { describe, it, expect, beforeEach } from 'vitest';
import { Sequence, BAR_MAX, type SeqCamera } from './sequence';

let now = 0;
let seq: Sequence;
let events: string[];
let sounds: string[];
let scripts: string[];
const infos = new Map<number, SeqCamera>([
  [2, { x: 100, y: 50, z: 0, pitch: 10, yaw: 90 }],
  [4, { x: 300, y: 50, z: 0, pitch: 0, yaw: 0 }],
  [5, { x: 300, y: 50, z: 400, pitch: 0, yaw: 180 }],
]);

function setup(): void {
  now = 1000;
  events = [];
  sounds = [];
  scripts = [];
  seq = new Sequence({
    now: () => now,
    cameraNow: () => ({ x: 0, y: 20, z: 0, pitch: 0, yaw: 0 }),
    info: id => infos.get(id),
    entityPos: (cls, id) => (cls === 2 && id === 100 ? { x: 0, y: 0, z: 1000 } : undefined),
    terrainY: () => 0,
    globalEvent: n => { events.push(`g:${n}`); },
    entityEvent: (c, i, n) => { events.push(`e:${c}:${i}:${n}`); },
    runScript: t => { scripts.push(t); },
    sound: f => { sounds.push(f); },
    loadText: src => (src === 'file.s2s' ? 'msg "hi";' : undefined),
    log: () => undefined,
  });
}

function tick(ms: number, step = 20): void {
  for (let t = 0; t < ms; t += step) {
    now += step;
    seq.update(step);
  }
}

beforeEach(setup);

describe('Sequence timeline', () => {
  it('runs events in absolute time with a multiplier and ends', () => {
    seq.start(1, 1);
    seq.timeMode(1000, 1);
    seq.add('msg', ['1', 'hello', '5', '0']);
    seq.add('event', ['2', 'scene2']);
    seq.add('event', ['2', 'hit', 'unit', '100']);
    seq.add('sound', ['1', 'a.ogg']);
    seq.add('end', ['3']);
    expect(seq.pending()).toBe(5);
    tick(500);
    expect(seq.msgs[0]).toBeNull();
    tick(600);
    expect(seq.msgs[0]).toEqual({ text: 'hello', color: 5 });
    expect(sounds).toEqual(['a.ogg']);
    tick(1000);
    expect(events).toEqual(['g:scene2', 'e:2:100:hit']);
    expect(seq.active).toBe(true);
    tick(1000);
    expect(seq.active).toBe(false);
    expect(seq.pending()).toBe(0);
  });

  it('relative time mode chains from the previous event', () => {
    seq.start();
    seq.timeMode(1, 0);
    seq.add('msg', ['500', 'a']);
    seq.add('msg', ['500', 'b']);
    seq.add('msgclear', ['500']);
    tick(600);
    expect(seq.msgs[0]?.text).toBe('a');
    tick(500);
    expect(seq.msgs[0]?.text).toBe('b');
    tick(500);
    expect(seq.msgs[0]).toBeNull();
  });

  it('expands campath into consecutive movecam segments', () => {
    seq.start();
    seq.add('campath', ['1000', '2000', '4', '5']);
    expect(seq.pending()).toBe(2);
    tick(1100);
    expect(seq.camera.x).toBeCloseTo(300 * 0.05, 0);
    tick(2000);
    expect(seq.camera.x).toBeGreaterThan(295);
    expect(seq.camera.z).toBeGreaterThan(0);
    tick(2000);
    expect(seq.camera.z).toBeCloseTo(400, 0);
  });

  it('setcam jumps to the info, movecam interpolates, cammode 1 looks at an entity', () => {
    seq.start();
    seq.add('setcam', ['0', '2']);
    seq.add('cammode', ['0', '3']);
    seq.add('movecam', ['0', '2000', '4']);
    tick(20);
    expect(seq.camera.x).toBeCloseTo(100 + 200 * (21 / 2000), 0);
    tick(1000);
    expect(seq.camera.x).toBeCloseTo(100 + 200 * (1021 / 2000), 0);
    expect(seq.camera.y).toBe(50);
    seq.add('cammode', ['1040', '1', 'unit', '100']);
    tick(40);
    expect(seq.camera.yaw).toBeCloseTo(Math.atan2(-(0 - seq.camera.x), 1000) * 180 / Math.PI, 3);
    expect(seq.camera.pitch).toBeGreaterThan(0);
    tick(1000);
    expect(seq.camera.x).toBeCloseTo(300, 3);
  });

  it('skip clears events, ends and fires skipsequence only when skipable', () => {
    seq.start(1, 0);
    seq.add('msg', ['1000', 'x']);
    expect(seq.skip()).toBe(false);
    expect(seq.active).toBe(true);
    seq.start(1, 1);
    seq.add('msg', ['1000', 'x']);
    expect(seq.skip()).toBe(true);
    expect(seq.active).toBe(false);
    expect(seq.pending()).toBe(0);
    expect(events).toEqual(['g:skipsequence']);
  });

  it('bars grow 2 px per f and fades follow their modes', () => {
    seq.start(1, 0);
    seq.add('fade', ['0', '1000', '0', '0', '0', '2']);
    seq.add('fade', ['2000', '3000', '255', '0', '0', '1']);
    seq.add('fade', ['4000', '5000', '0', '0', '255', '0']);
    seq.add('flash', ['6000']);
    tick(20);
    expect(seq.barPx).toBeCloseTo(2, 5);
    expect(seq.fadeColor()?.a).toBeCloseTo(1 - 21 / 1000, 2);
    tick(480);
    expect(seq.fadeColor()?.a).toBeCloseTo(0.5, 1);
    tick(2000);
    expect(seq.barPx).toBe(BAR_MAX);
    expect(seq.fadeColor()).toEqual(expect.objectContaining({ r: 255, g: 0, b: 0 }));
    expect(seq.fadeColor()!.a).toBeCloseTo(0.5, 1);
    tick(2000);
    expect(seq.fadeColor()!.a).toBeCloseTo(1, 1);
    tick(1500);
    expect(seq.fadeColor()).toBeNull();
    expect(seq.flashColor()).toEqual(expect.objectContaining({ r: 255 }));
    tick(500);
    expect(seq.flashColor()).toBeNull();
  });

  it('seqscript loads its source at registration and runs it when due', () => {
    seq.start();
    seq.add('script', ['0', 'file.s2s']);
    seq.add('cls', ['0', '1', '10', '20', '30']);
    seq.add('image', ['0', 'maps/adventure/img/outro1.rfl']);
    seq.add('itxt', ['0', 'hi', '20', '60', '4']);
    tick(20);
    expect(scripts).toEqual(['msg "hi";']);
    expect(seq.cls).toEqual({ on: true, r: 10, g: 20, b: 30 });
    expect(seq.image?.path).toBe('maps/adventure/img/outro1.rfl');
    expect(seq.imageTexts).toEqual([{ text: 'hi', x: 20, y: 60, color: 4, align: 0 }]);
  });
});
