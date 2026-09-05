import * as THREE from 'three';
import './style.css';
import { Log } from './log';
import { Resources } from '../assets/resources';
import { parseS2Map, PREVIEW_W, PREVIEW_H, type MapData } from '../formats/s2map';
import { buildDefTable } from '../formats/inf';
import { buildTerrain, CELL } from '../render/terrain';
import { buildSea } from '../render/sea';
import { buildSky, SKY_FACES, type SkyFace } from '../render/sky';
import { buildWorld, type Defs } from '../render/world';
import { FlyControls } from './fly-controls';
import { GameSession } from '../game/session';
import { Environment } from '../game/environment';
import { parseLightcycle } from '../game/lightcycle';

const DEFAULT_MAP = 'maps/adventure/map02.s2';

async function listFiles(dir: string): Promise<string[]> {
  const res = await fetch(`/__list?dir=${encodeURIComponent(dir)}`);
  if (!res.ok) return [];
  return res.json();
}

async function loadDefs(res: Resources): Promise<Defs> {
  const files = await listFiles('sys');
  const load = (prefix: string) =>
    Promise.all(files.filter(f => f.toLowerCase().startsWith(prefix) && f.toLowerCase().endsWith('.inf')).map(f => res.text(`/sys/${f}`)));
  const [objects, units, items] = await Promise.all([load('objects'), load('units'), load('items')]);
  return { objects: buildDefTable(objects), units: buildDefTable(units), items: buildDefTable(items) };
}

function drawPreview(canvas: HTMLCanvasElement, map: MapData): void {
  canvas.width = PREVIEW_W;
  canvas.height = PREVIEW_H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(PREVIEW_W, PREVIEW_H);
  for (let x = 0; x < PREVIEW_W; x++) {
    for (let y = 0; y < PREVIEW_H; y++) {
      const s = (x * PREVIEW_H + y) * 3;
      const d = (y * PREVIEW_W + x) * 4;
      img.data[d] = map.preview[s];
      img.data[d + 1] = map.preview[s + 1];
      img.data[d + 2] = map.preview[s + 2];
      img.data[d + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  const canvas = document.createElement('canvas');
  canvas.className = 'view';
  const hud = document.createElement('div');
  hud.className = 'hud';
  const select = document.createElement('select');
  const preview = document.createElement('canvas');
  const statsEl = document.createElement('pre');
  const playBtn = document.createElement('button');
  playBtn.textContent = '进入游戏';
  hud.append(select, preview, statsEl, playBtn);
  const logEl = document.createElement('div');
  const help = document.createElement('div');
  help.className = 'help';
  help.textContent = '拖拽鼠标转视角，WASD 移动，QE 升降，Shift 加速';
  app.append(canvas, hud, logEl, help);
  const log = new Log(logEl);

  const params = new URLSearchParams(location.search);
  const mapPath = params.get('map') ?? DEFAULT_MAP;
  const maps = await listFiles('maps');
  for (const m of maps.filter(f => f.endsWith('.s2'))) {
    const opt = document.createElement('option');
    opt.value = `maps/${m}`;
    opt.textContent = m;
    opt.selected = opt.value === mapPath;
    select.append(opt);
  }
  select.addEventListener('change', () => {
    location.search = `?map=${encodeURIComponent(select.value)}`;
  });

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 1, 60000);
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  const res = new Resources(log);
  log.info(`加载 ${mapPath}`);
  const t0 = performance.now();
  const [defs, mapBytes] = await Promise.all([loadDefs(res), res.bytes('/' + mapPath)]);
  const map = parseS2Map(mapBytes);
  drawPreview(preview, map);
  log.info(`定义 objects ${defs.objects.size} units ${defs.units.size} items ${defs.items.size}`);
  log.info(`地图 ${map.terrainSize}x${map.terrainSize} 天空 ${map.header.skybox || 'sky'} 时间 ${map.header.hour}:${map.header.minute}`);

  const ambient = new THREE.AmbientLight(0xffffff, 1.2);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, 2, 1);
  scene.add(sun);

  const skyName = map.header.skybox || 'sky';
  const skyTex = {} as Record<SkyFace, THREE.Texture | null>;
  await Promise.all(SKY_FACES.map(async f => { skyTex[f] = await res.texture(`/skies/${skyName}_${f}.jpg`); }));
  const sky = buildSky(skyTex);
  scene.add(sky);

  const detail = await res.texture('/sys/gfx/terraindirt.bmp');
  scene.add(buildTerrain(map, detail));
  const sea = buildSea(await res.texture('/gfx/water.jpg'), map.terrainSize * CELL * 6);
  scene.add(sea.group);

  const world = await buildWorld(map, defs, res, log);
  scene.add(world.group);
  const cycle = parseLightcycle(await res.text('/sys/lightcycle.inf'));
  new Environment(scene, sky, ambient, sun, map.header.fog, cycle).apply(map.header.hour, map.header.minute);
  log.info(`实体 objects ${world.stats.objects} units ${world.stats.units} items ${world.stats.items} 缺失 ${world.stats.missing}，${Math.round(performance.now() - t0)} ms`);

  const player = map.units.find(u => u.typ === 1);
  if (player) {
    camera.position.set(player.x, player.y + 60, -player.z);
  } else {
    camera.position.set(0, 800, map.terrainSize * CELL / 2);
  }
  camera.lookAt(0, camera.position.y - 40, 0);
  const controls = new FlyControls(camera, canvas);
  const debug: Record<string, unknown> = { scene, camera, controls, map, world, renderer, defs };
  (window as unknown as { viewer: unknown }).viewer = debug;

  let session: GameSession | undefined;
  const enterPlay = async () => {
    if (session) return;
    session = await GameSession.create({ scene, camera, canvas, root: app, map, defs, world, res, log, sky, ambient, sun });
    debug.session = session;
    document.body.classList.add('play');
    session.input.requestLock();
  };
  playBtn.addEventListener('click', () => { void enterPlay(); });
  if (params.get('mode') === 'play') void enterPlay();

  const timer = new THREE.Timer();
  let frames = 0;
  let fpsTime = 0;
  const loop = () => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    if (session) session.update(dt * 1000);
    else controls.update(dt);
    sea.update(dt);
    for (const m of world.mixers) m.update(dt);
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
    frames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      const p = camera.position;
      statsEl.textContent = `fps ${Math.round(frames / fpsTime)}\n位置 ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${(-p.z).toFixed(0)}\n物体 ${world.stats.objects} 单位 ${world.stats.units} 物品 ${world.stats.items} 缺失 ${world.stats.missing}`;
      frames = 0;
      fpsTime = 0;
    }
    requestAnimationFrame(loop);
  };
  loop();
}

main().catch(e => {
  console.error(e);
  const el = document.createElement('pre');
  el.style.color = '#f66';
  el.style.padding = '16px';
  el.textContent = `加载失败：${(e as Error).stack ?? e}`;
  document.getElementById('app')!.append(el);
});
