import { describe, it, expect, beforeEach } from 'vitest';
import { FakeHost } from '../fake-host';
import { ScriptEngine } from '../engine';
import { createRegistry } from './index';
import { CLASS } from '../host';
import type { ExecEnv } from '../interpreter';

let host: FakeHost;
let engine: ScriptEngine;
const env: ExecEnv = { cls: CLASS.item, id: 7, event: 'eat', info: '' };
const run = (t: string, e: ExecEnv = env) => engine.runText(t, e, 'test');
const g = (n: string) => engine.vars.globals.get(n) ?? '0';

beforeEach(() => {
  host = new FakeHost();
  engine = new ScriptEngine(host, createRegistry());
  host.add(CLASS.unit, 1, 1, { x: 10, z: 20 });
  host.add(CLASS.item, 9, 7, { count: 3, parentClass: 2, parentId: 1, parentMode: 1 });
  host.defs.set('3:9', { name: 'Meat', behaviour: 'throw', mat: 'flesh', group: 'food', weight: 500, health: 100 });
  host.defs.set('3:24', { name: 'Branch', behaviour: '', mat: 'wood', group: 'material', weight: 100, health: 100 });
  host.defs.set('2:2', { name: 'Raptor', behaviour: 'raptor', mat: 'flesh', group: 'animal', weight: 0, health: 110 });
});

describe('commands', () => {
  it('eat consumes one item and changes player values', () => {
    host.playerState.hunger = 50; host.playerState.thirst = 30; host.playerState.health = 80;
    run(`eat 5,20,10,0;`);
    expect(host.entity(CLASS.item, 7)!.count).toBe(2);
    expect([host.playerState.health, host.playerState.hunger, host.playerState.thirst]).toEqual([85, 30, 20]);
    run(`eat 0,0,0,0;`); run(`eat 0,0,0,0;`);
    expect(host.entity(CLASS.item, 7)).toBeUndefined();
  });
  it('find gives items and playergotitem counts', () => {
    run(`find 24,3; $n=playergotitem(24); $m=playergotitem(9);`);
    expect([g('n'), g('m')]).toEqual(['3', '3']);
    expect(host.messages[0].text).toContain('Branch');
  });
  it('freestored and count_stored', () => {
    run(`find 24,3; freestored "unit",1,24,1; $a=count_stored("unit",1,24); $b=count_stored("unit",1);`);
    expect([g('a'), g('b')]).toEqual(['2', '5']);
    run(`freestored "unit",1; $c=count_stored("unit",1);`);
    expect(g('c')).toBe('0');
  });
  it('create, exists, getx, free', () => {
    run(`$id=create("item",24,10,20); $e=exists("item",$id); $x=getx("item",$id); free "item",$id; $e2=exists("item",$id);`);
    expect([g('e'), g('x'), g('e2')]).toEqual(['1', '10.0', '0']);
    run(`$u=create("unit",2); $t=type("unit",$u); $n=name("unit",2); $b=compare_behaviour("unit",$u,"raptor");`);
    expect([g('t'), g('n'), g('b')]).toEqual(['2', 'Raptor', '1']);
  });
  it('count_inrange counts around the player', () => {
    host.add(CLASS.unit, 2, undefined, { x: 100, z: 20 });
    host.add(CLASS.unit, 2, undefined, { x: 900, z: 20 });
    run(`$a=count_inrange("unit",2,300); $b=count_inrange("unit",2,50); $c=count("unit",2);`);
    expect([g('a'), g('b'), g('c')]).toEqual(['1', '0', '2']);
  });
  it('alteritem in on:use swaps items in the inventory', () => {
    run(`alteritem 1,10;`, { cls: CLASS.item, id: 7, event: 'use', info: '' });
    expect(host.entity(CLASS.item, 7)!.count).toBe(2);
    expect(host.entities(CLASS.item, 10).length).toBe(1);
  });
  it('setpos keeps "self" coordinates and setat moves onto another entity', () => {
    host.add(CLASS.info, 1, 17, { x: 300, y: 12, z: -40 });
    run(`setpos "unit",1,"self",5,"self"; $x=getx("unit",1); $y=gety("unit",1); $z=getz("unit",1);`);
    expect([g('x'), g('y'), g('z')]).toEqual(['10.0', '5.0', '20.0']);
    run(`$p=create("unit",2); setat "unit",$p,"info",17; $px=getx("unit",$p); $pz=getz("unit",$p);`);
    expect([g('px'), g('pz')]).toEqual(['300.0', '-40.0']);
    run(`setat "item",7,"info",17;`);
    expect(host.entity(CLASS.item, 7)!.x).toBe(0);
  });
  it('dialogue buttons, cracklock and msg_extend', () => {
    run(`button 0,"How to fish",17,"teach_fishing"; button 9,"Back",17,"start"; freebutton 0; clear; add "x"; button 2,"Buf";`);
    expect([...host.buttons.entries()]).toEqual([[9, { text: 'Back', target: 'start' }], [2, { text: 'Buf', target: 'x' }]]);
    run(`cracklock "Cracking lock",2,"LRL";`, { cls: CLASS.object, id: 354, event: 'use', info: '' });
    expect(host.cracks).toEqual([{ title: 'Cracking lock', mode: 2, code: 'lrl', cls: CLASS.object, id: 354 }]);
    run(`clear; add "Hahaha"; msg_extend;`);
    expect(host.extended).toEqual(['Hahaha']);
  });
  it('freeze, playerspotted and autosave', () => {
    host.add(CLASS.unit, 2, 30);
    run(`freeze 30; $a=freeze(30,2); freeze 30,0; $b=freeze(30,2); freeze 0,1; $c=freeze(1,2);`);
    expect([g('a'), g('b'), g('c')]).toEqual(['1', '0', '1']);
    host.spotted = true;
    run(`if (playerspotted()==0) { autosave; } $s=playerspotted();`);
    expect([g('s'), host.autosaves]).toEqual(['1', 0]);
  });
  it('model, scale, fx and color change the look of an entity', () => {
    host.add(CLASS.object, 178, 40);
    run(`model "gfx/yacht_01.b3d","object",40; fx 16,"object",40; scale 1.76,1.76,1.76,"object",40; model "x.b3d","unit",1;`);
    expect(host.looks.get('1:40')).toEqual({ model: 'gfx/yacht_01.b3d', fx: 16, scale: [1.76, 1.76, 1.76] });
    expect(host.looks.has('2:1')).toBe(false);
    run(`color 255,200,200;`, { cls: CLASS.object, id: 40, event: 'load', info: '' });
    expect(host.looks.get('1:40')).toMatchObject({ color: [255, 200, 200] });
  });
  it('skycolor sets and clears the sky override', () => {
    run(`skycolor 1,255,50,50,20;`);
    expect(host.sky).toEqual({ color: [255, 50, 50], mix: 20 });
    run(`skycolor 0;`);
    expect(host.sky).toBeNull();
  });
  it('explosion passes position, range, damage and style with the original defaults', () => {
    run(`explosion 1,2,3; explode 4,5,6,100,0,3;`);
    expect(host.explosions).toEqual([[1, 2, 3, 50, 50, 1], [4, 5, 6, 100, 0, 3]]);
  });
  it('savevars and loadvars keep globals in a named cache', () => {
    run(`$score=12; $name="x"; $ok=savevars("colorgame","score"); $all=savevars();`);
    engine.vars.globals.set('score', '0');
    run(`$l=loadvars("colorgame"); $miss=loadvars("nothing");`);
    expect([g('ok'), g('all'), g('score'), g('l'), g('miss')]).toEqual(['1', '1', '12', '1', '0']);
    expect(host.varCaches.get('varcache')?.map(e => e[0])).toContain('name');
    run(`msg_replace "a","b";`);
    expect(host.replacements).toEqual([['a', 'b']]);
  });
  it('globalEventNow runs every script at once and reports skipevent', () => {
    host.add(CLASS.unit, 37, 30);
    engine.addInstanceScript(CLASS.unit, 30, 'on:sleep { $pirate=1; }');
    engine.setMapScript('on:sleep { $map=1; }', 'map');
    expect(engine.globalEventNow('sleep')).toBe(false);
    expect([g('pirate'), g('map')]).toEqual(['1', '1']);
    engine.setGameScript('on:sleep { if ($tired==0) { skipevent; } }', 'game');
    expect(engine.globalEventNow('sleep')).toBe(true);
    run('sleep;');
    expect(host.sleeps).toBe(1);
  });
  it('map opens the map screen and indicators toggle only on map markers', () => {
    host.add(CLASS.info, 36, 43);
    host.add(CLASS.info, 40, 37);
    run('map; showindicator 43; showindicator 37;');
    expect([host.maps, [...host.indicators]]).toEqual([1, [43]]);
    run('hideindicator 43;');
    expect(host.indicators.size).toBe(0);
    expect(host.logs.some(l => l.includes('not a map indicator'))).toBe(true);
  });
  it('getplayervalue uses the original 1-based indexes', () => {
    Object.assign(host.playerState, { health: 90, hunger: 20, thirst: 30, exhaustion: 40 });
    run('$a=getplayervalue(1); $b=getplayervalue(2); $c=getplayervalue(3); $d=getplayervalue(4);');
    expect([g('a'), g('b'), g('c'), g('d')]).toEqual(['90', '20', '30', '40']);
  });
  it('store and unstore', () => {
    run(`$id=create("item",24,0,0); $s=store($id,"unit",1); $c=count_stored("unit",1,24); unstore $id; $c2=count_stored("unit",1,24);`);
    expect([g('s'), g('c'), g('c2')]).toEqual(['1', '1', '0']);
  });
  it('damage and health', () => {
    run(`damage "unit",1,30; $h=health("unit",1); $l=lives("unit",1); heal "unit",1,10; $h2=health("unit",1);`);
    expect([g('h'), g('l'), g('h2')]).toEqual(['70.0', '1', '80.0']);
  });
  it('msg fonts and process', () => {
    run(`msg "a",3; msg "b",9,500; process "digging",1500,"dug"; play "x.wav"; speech "negative";`);
    expect(host.messages.map(m => [m.font, m.duration])).toEqual([[3, 3000], [0, 500]]);
    expect(host.processes[0]).toEqual({ title: 'digging', ms: 1500, event: 'dug' });
    expect(host.sounds).toEqual(['x.wav']);
    expect(host.speeches).toEqual(['negative']);
  });
  it('addscript loads file sections', () => {
    host.files.set('sys/scripts/chars.s2s', `//~a\non:use { $a=1; }\n//~b\non:use { $b=1; }\n`);
    run(`addscript "item",7,"sys\\scripts\\chars.s2s","b";`);
    engine.runNow(CLASS.item, 7, 'use');
    expect([g('a'), g('b')]).toEqual(['0', '1']);
  });
  it('time commands', () => {
    run(`sethour 20; setminute 30; $h=hour(); $m=minute(); $d=day();`);
    expect([g('h'), g('m'), g('d')]).toEqual(['20', '30', '1']);
  });
});
