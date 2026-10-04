/** 用 HTMLAudio 播放 sfx/ 下的音效与循环音乐；文件缺失时静默。 */
import { assetUrl } from '../assets/paths';
import { assetBundle } from '../assets/bundle';

/** sfx 下的文件：素材包里有就用 blob URL，否则按站点路径请求。 */
function soundUrl(file: string): string {
  const name = file.replace(/\\/g, '/').replace(/^\/+/, '');
  const path = name.startsWith('sfx/') ? name : `sfx/${name}`;
  return assetBundle()?.blobUrl(path) ?? encodeURI(assetUrl(path));
}
/** 同时播放的音效上限；浏览器的媒体播放器数量有限，超出时丢弃新音效。 */
const MAX_VOICES = 24;
/** 3D 音效的衰减系数（load_setup.bb CreateListener 的 rolloff）。 */
const ROLLOFF = 0.02;

export class Sounds {
  private readonly failed = new Set<string>();
  /** 正在播放的音效数，以及按 URL 缓存的空闲播放器（播完后复用）。 */
  private voices = 0;
  private readonly idle = new Map<string, HTMLAudioElement[]>();
  enabled = true;
  /** 音效音量 0..1（set_fxvolume），乘在每个音效上。 */
  sfxVolume = 1;
  private track: HTMLAudioElement | null = null;
  private trackVolume = 1;
  private musicVolume = 1;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private readonly loops = new Map<string, { url: string; audio: HTMLAudioElement }>();
  private readonly channels = new Map<string, HTMLAudioElement>();

  /** 循环播放一段音乐并替换当前曲目；volume 为 0..1。 */
  music(file: string, volume = 1): void {
    this.stopMusic();
    if (!this.enabled || typeof Audio === 'undefined' || !file) return;
    const url = soundUrl(file);
    try {
      const a = new Audio(url);
      a.loop = true;
      this.trackVolume = Math.max(0, Math.min(1, volume));
      a.volume = this.trackVolume * this.musicVolume;
      a.addEventListener('error', () => { if (this.track === a) this.track = null; });
      void a.play().catch(() => undefined);
      this.track = a;
    } catch {
      this.track = null;
    }
  }

  /** 暂停或继续当前曲目（水下时环境音换成潜水声）。 */
  pauseMusic(paused: boolean): void {
    if (!this.track) return;
    if (paused) this.track.pause();
    else void this.track.play().catch(() => undefined);
  }

  stopMusic(): void {
    if (this.fadeTimer) { clearInterval(this.fadeTimer); this.fadeTimer = null; }
    if (this.track) { this.track.pause(); this.track = null; }
  }

  /** 在 ms 毫秒内把音乐音量降到 0 后停止。 */
  fadeMusic(ms: number): void {
    const a = this.track;
    if (!a) return;
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    const start = Date.now();
    const from = a.volume;
    this.fadeTimer = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / Math.max(ms, 1));
      a.volume = from * (1 - t);
      if (t >= 1) this.stopMusic();
    }, 50);
  }

  /** 按 key 管理的循环音效（雨声、水下环境音等）：同 key 换文件会替换，file 为 null 停止。 */
  loop(key: string, file: string | null, volume = 100): void {
    const cur = this.loops.get(key);
    const url = file ? soundUrl(file) : null;
    if (cur && cur.url === url) {
      cur.audio.volume = Math.max(0, Math.min(1, (volume / 100) * this.sfxVolume));
      return;
    }
    if (cur) { cur.audio.pause(); this.loops.delete(key); }
    if (!url || !this.enabled || typeof Audio === 'undefined' || this.failed.has(url)) return;
    try {
      const a = new Audio(url);
      a.loop = true;
      a.volume = Math.max(0, Math.min(1, (volume / 100) * this.sfxVolume));
      a.addEventListener('error', () => { this.failed.add(url); });
      void a.play().catch(() => undefined);
      this.loops.set(key, { url, audio: a });
    } catch {
      this.failed.add(url);
    }
  }

  stopLoops(): void {
    for (const l of this.loops.values()) l.audio.pause();
    this.loops.clear();
    for (const a of this.channels.values()) a.pause();
    this.channels.clear();
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    if (this.track) this.track.volume = this.trackVolume * this.musicVolume;
  }

  /** 听者位置（镜头，Blitz 坐标），playAt 按它计算距离衰减。 */
  listener = { x: 0, y: 0, z: 0 };

  /**
   * 3D 音效（sfx_emit）：原版听者 CreateListener(cam,0.02,1,1)，按反比衰减，音量 = 1/(1+0.02×距离)。
   * 不做左右声道定位。
   */
  playAt(file: string, at: { x: number; y: number; z: number }, volume = 100): void {
    const d = Math.hypot(at.x - this.listener.x, at.y - this.listener.y, at.z - this.listener.z);
    this.play(file, volume / (1 + ROLLOFF * Math.max(0, d - 1)));
  }

  /**
   * 按 key 的单次声道（单位移动声）：同 key 的上一声还在播就只更新音量，播完才重新开始；file 为 null 时停止。
   */
  channel(key: string, file: string | null, at?: { x: number; y: number; z: number }, volume = 100): void {
    const cur = this.channels.get(key);
    if (!file) {
      if (cur) { cur.pause(); this.channels.delete(key); }
      return;
    }
    const gain = at ? 1 / (1 + ROLLOFF * Math.max(0, Math.hypot(at.x - this.listener.x, at.y - this.listener.y, at.z - this.listener.z) - 1)) : 1;
    const v = Math.max(0, Math.min(1, (volume / 100) * gain * this.sfxVolume));
    if (cur && !cur.ended && !cur.paused) { cur.volume = v; return; }
    if (!this.enabled || typeof Audio === 'undefined') return;
    const url = soundUrl(file);
    if (this.failed.has(url)) return;
    try {
      cur?.pause();
      const a = new Audio(url);
      a.volume = v;
      a.addEventListener('error', () => { this.failed.add(url); }, { once: true });
      void a.play().catch(() => undefined);
      this.channels.set(key, a);
    } catch {
      this.failed.add(url);
    }
  }

  play(file: string, volume = 100): void {
    if (!this.enabled || typeof Audio === 'undefined' || this.voices >= MAX_VOICES) return;
    const url = soundUrl(file);
    if (this.failed.has(url)) return;
    try {
      const a = this.idle.get(url)?.pop() ?? this.create(url);
      a.volume = Math.max(0, Math.min(1, (volume / 100) * this.sfxVolume));
      a.currentTime = 0;
      this.voices++;
      void a.play().catch(() => { this.failed.add(url); this.release(url, a); });
    } catch {
      this.failed.add(url);
    }
  }

  private create(url: string): HTMLAudioElement {
    const a = new Audio(url);
    a.addEventListener('error', () => { this.failed.add(url); this.release(url, a); });
    a.addEventListener('ended', () => this.release(url, a));
    return a;
  }

  private release(url: string, a: HTMLAudioElement): void {
    this.voices = Math.max(0, this.voices - 1);
    const list = this.idle.get(url) ?? [];
    if (!list.includes(a)) list.push(a);
    this.idle.set(url, list);
  }
}
