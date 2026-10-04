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

export class Sounds {
  private readonly failed = new Set<string>();
  /** 正在播放的音效数，以及按 URL 缓存的空闲播放器（播完后复用）。 */
  private voices = 0;
  private readonly idle = new Map<string, HTMLAudioElement[]>();
  enabled = true;
  private track: HTMLAudioElement | null = null;
  private trackVolume = 1;
  private musicVolume = 1;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private readonly loops = new Map<string, { url: string; audio: HTMLAudioElement }>();

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
      cur.audio.volume = Math.max(0, Math.min(1, volume / 100));
      return;
    }
    if (cur) { cur.audio.pause(); this.loops.delete(key); }
    if (!url || !this.enabled || typeof Audio === 'undefined' || this.failed.has(url)) return;
    try {
      const a = new Audio(url);
      a.loop = true;
      a.volume = Math.max(0, Math.min(1, volume / 100));
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
  }

  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    if (this.track) this.track.volume = this.trackVolume * this.musicVolume;
  }

  play(file: string, volume = 100): void {
    if (!this.enabled || typeof Audio === 'undefined' || this.voices >= MAX_VOICES) return;
    const url = soundUrl(file);
    if (this.failed.has(url)) return;
    try {
      const a = this.idle.get(url)?.pop() ?? this.create(url);
      a.volume = Math.max(0, Math.min(1, volume / 100));
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
