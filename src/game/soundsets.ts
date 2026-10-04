/**
 * 单位音效组，依据 ressources.bb 的 load_soundset / play_soundset：单位定义 sfx=name，事件音效为 sfx/name_event.wav；
 * 不存在时找同名 .inf，其第一行是实际播放的文件名（load_res 的重定向）。
 */
export type SoundEvent = 'spot' | 'attack' | 'idle1' | 'idle2' | 'idle3' | 'die' | 'flee' | 'move';

const EVENTS: SoundEvent[] = ['spot', 'attack', 'idle1', 'idle2', 'idle3', 'die', 'flee', 'move'];

export class SoundSets {
  private readonly files = new Map<string, string>();

  /** files 为 sfx 目录的文件名；readInf 读取 .inf 重定向文件的文本。 */
  static async load(files: string[], readInf: (name: string) => Promise<string>): Promise<SoundSets> {
    const sets = new SoundSets();
    const have = new Set(files.map(f => f.toLowerCase()));
    const pending: Promise<void>[] = [];
    for (const f of files) {
      const m = /^(.+)_(spot|attack|idle[123]|die|flee|move)\.(wav|inf)$/i.exec(f);
      if (!m) continue;
      const key = `${m[1].toLowerCase()}_${m[2].toLowerCase()}`;
      if (m[3].toLowerCase() === 'wav') sets.files.set(key, f);
      else if (!have.has(`${key}.wav`)) {
        pending.push(readInf(f).then(text => {
          const target = text.split(/\r?\n/)[0]?.trim();
          if (target && !sets.files.has(key)) sets.files.set(key, target);
        }).catch(() => undefined));
      }
    }
    await Promise.all(pending);
    return sets;
  }

  file(set: string, event: SoundEvent): string | null {
    if (!set || !EVENTS.includes(event)) return null;
    return this.files.get(`${set.trim().toLowerCase()}_${event}`) ?? null;
  }
}
