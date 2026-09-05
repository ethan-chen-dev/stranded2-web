/** 用 HTMLAudio 播放 sfx/ 下的音效；文件缺失时静默。 */
export class Sounds {
  private readonly failed = new Set<string>();
  enabled = true;

  play(file: string, volume = 100): void {
    if (!this.enabled || typeof Audio === 'undefined') return;
    const name = file.replace(/\\/g, '/').replace(/^\/+/, '');
    const url = name.startsWith('sfx/') ? `/${name}` : `/sfx/${name}`;
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
