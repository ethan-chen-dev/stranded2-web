/**
 * 地图界面，依据 interface.bb 的 if_map 与 functions.bb 的 genmap：按地形高度着色的 256×256 底图，
 * 已显示的地图标记（信息点 36）用 arrows.bmp 的帧画出，玩家位置超出底图时贴边画指向箭头，
 * 绿线为玩家朝向。原版底图 X 与 Z 都翻转（东在左、北在下），这里照搬。
 */
export const MAP_SIZE = 256;
const HALF = MAP_SIZE / 2;
const ARROW = 16;
const ARROW_COLS = 3;

export interface MapMarker {
  /** Blitz 坐标。 */
  x: number;
  z: number;
  /** arrows.bmp 的帧号（信息点 ints[0]）。 */
  frame: number;
  label: string;
}

export interface MapViewData {
  terrain: HTMLCanvasElement;
  /** 地形边长（格数），每格 64 单位。 */
  terrainSize: number;
  markers: MapMarker[];
  /** 玩家 Blitz 坐标与偏航角（度）。 */
  player: { x: number; z: number; yaw: number };
  arrows: HTMLCanvasElement | null;
}

/** genmap：高度按 3200 归一，陆地偏黄褐，水下向浅蓝混合，每 16/64 像素加暗网格。 */
export function renderTerrainMap(heightAt: (x: number, z: number) => number, terrainSize: number, random: () => number = Math.random): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MAP_SIZE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(MAP_SIZE, MAP_SIZE);
  const extent = terrainSize * 64;
  const fac = extent / (MAP_SIZE - 1);
  for (let x = 0; x < MAP_SIZE; x++) {
    for (let y = 0; y < MAP_SIZE; y++) {
      const h = heightAt(-extent / 2 + x * fac, -extent / 2 + y * fac) / 3200;
      let r = 118 + 137 * h;
      let g = 105 + 137 * h;
      let b = 52 + 137 * h;
      if (h < 0) {
        r = (r * 3 + 41) / 4;
        g = (g * 3 + 221) / 4;
        b = (b * 3 + 241) / 4;
      }
      const dim = x % 64 === 0 || y % 64 === 0 ? 1.1 + random() * 0.1 : x % 16 === 0 || y % 16 === 0 ? 1.02 + random() * 0.03 : 1;
      const i = (y * MAP_SIZE + (MAP_SIZE - 1 - x)) * 4;
      img.data[i] = r / dim;
      img.data[i + 1] = g / dim;
      img.data[i + 2] = b / dim;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** 世界坐标到底图中心偏移（像素）。 */
function toMap(x: number, z: number, fac: number): [number, number] {
  return [x / -fac, z / fac];
}

/** 玩家在底图外时贴边箭头的帧（if_map 的 sx/sy 表）。 */
export function edgeFrame(px: number, py: number): number {
  const sx = Math.floor((px + HALF + 32) / 32);
  const sy = Math.floor((py + HALF + 32) / 32);
  const col = sx <= 2 ? 0 : sx <= 6 ? 1 : 2;
  const row = sy <= 2 ? 0 : sy <= 6 ? 1 : 2;
  return [[8, 7, 6], [1, 0, 5], [2, 3, 4]][col][row];
}

function drawArrow(ctx: CanvasRenderingContext2D, arrows: HTMLCanvasElement | null, frame: number, cx: number, cy: number): void {
  if (!arrows) {
    ctx.fillStyle = '#ff3030';
    ctx.fillRect(cx - 3, cy - 3, 6, 6);
    return;
  }
  const sx = (frame % ARROW_COLS) * ARROW;
  const sy = Math.floor(frame / ARROW_COLS) * ARROW;
  ctx.drawImage(arrows, sx, sy, ARROW, ARROW, Math.round(cx - ARROW / 2), Math.round(cy - ARROW / 2), ARROW, ARROW);
}

/** 返回地图界面元素；鼠标停在标记或玩家上时显示名称。 */
export function buildMapView(d: MapViewData): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'map-view';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MAP_SIZE;
  const label = document.createElement('div');
  label.className = 'map-label';
  label.hidden = true;
  wrap.append(canvas, label);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(d.terrain, 0, 0);
  const fac = (d.terrainSize * 64) / MAP_SIZE;
  const spots: { x: number; y: number; text: string }[] = [];
  for (const m of d.markers) {
    const [px, py] = toMap(m.x, m.z, fac);
    drawArrow(ctx, d.arrows, m.frame, HALF + px, HALF + py);
    if (m.label) spots.push({ x: HALF + px, y: HALF + py, text: m.label });
  }
  let [px, py] = toMap(d.player.x, d.player.z, fac);
  let frame = 0;
  if (Math.abs(px) > HALF - 1 || Math.abs(py) > HALF - 1) {
    px = Math.max(-(HALF - 1), Math.min(HALF - 1, px));
    py = Math.max(-(HALF - 1), Math.min(HALF - 1, py));
    frame = edgeFrame(px, py);
  }
  drawArrow(ctx, d.arrows, frame, HALF + px, HALF + py);
  const yaw = (d.player.yaw * Math.PI) / 180;
  ctx.strokeStyle = 'rgb(0,230,0)';
  ctx.beginPath();
  ctx.moveTo(HALF + px, HALF + py);
  ctx.lineTo(HALF + px + Math.sin(yaw) * 10, HALF + py + Math.cos(yaw) * 10);
  ctx.stroke();
  spots.push({ x: HALF + px, y: HALF + py, text: 'Location' });
  canvas.addEventListener('mousemove', ev => {
    const r = canvas.getBoundingClientRect();
    const mx = ((ev.clientX - r.left) / r.width) * MAP_SIZE;
    const my = ((ev.clientY - r.top) / r.height) * MAP_SIZE;
    const hit = spots.find(s => Math.abs(s.x - mx) < 8 && Math.abs(s.y - my) < 8);
    label.hidden = !hit;
    if (hit) {
      label.textContent = hit.text;
      label.style.left = `${(hit.x / MAP_SIZE) * 100}%`;
      label.style.top = `${(hit.y / MAP_SIZE) * 100}%`;
    }
  });
  canvas.addEventListener('mouseleave', () => { label.hidden = true; });
  return wrap;
}
