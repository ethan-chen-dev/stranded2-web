/** 用 HTMLAudio 播放 sfx/ 下的音效与循环音乐；文件缺失时静默。 */
import { assetUrl } from '../assets/paths';
export class Sounds {
  private readonly failed = new Set<string>();
  enabled = true;
  private track: HTMLAudioElement | null = null;
  private trackVolume = 1;
  private musicVolume = 1;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;

  /** 循环播放一段音乐并替换当前曲目；volume 为 0..1。 */
  music(file: string, volume = 1): void {
    this.stopMusic();
    if (!this.enabled || typeof Audio === 'undefined' || !file) return;
    const name = file.replace(/\\/g, '/').replace(/^\/+/, '');
    const url = assetUrl(name.startsWith('sfx/') ? name : `sfx/${name}`);
    try {
      const a = new Audio(encodeURI(url));
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

  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    if (this.track) this.track.volume = this.trackVolume * this.musicVolume;
  }

  play(file: string, volume = 100): void {
    if (!this.enabled || typeof Audio === 'undefined') return;
    const name = file.replace(/\\/g, '/').replace(/^\/+/, '');
    const url = assetUrl(name.startsWith('sfx/') ? name : `sfx/${name}`);
    if (this.failed.has(url)) return;
    try {
      const a = new Audio(encodeURI(url));
      a.volume = Math.max(0, Math.min(1, volume / 100));
      a.addEventListener('error', () => this.failed.add(url));
      void a.play().catch(() => this.failed.add(url));
    } catch {
      this.failed.add(url);
    }
  }
}
