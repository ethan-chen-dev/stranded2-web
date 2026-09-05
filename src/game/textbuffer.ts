/** 脚本文本缓冲（loadfile/buffer/clear/add）与带颜色前缀的文本行拆分。 */

export class TextBuffer {
  value = '';

  clear(): void {
    this.value = '';
  }

  /** 追加一行；原版以 0xA6 分行，这里统一用换行。 */
  add(line: string): void {
    this.value = this.value === '' ? line : `${this.value}\n${line}`;
  }

  set(text: string): void {
    this.value = text;
  }

  /** 取出内容并清空。 */
  take(): string {
    const v = this.value;
    this.value = '';
    return v;
  }
}

export interface ColoredLine {
  text: string;
  /** 字体颜色编号 0..6；-1 为缺省。 */
  color: number;
}

/** 行首 `!N` 指定该行颜色；0xA6 与换行都视为分行。 */
export function splitColoredLines(text: string, defaultColor = -1): ColoredLine[] {
  return text.split(/\r?\n|¦/).map(line => {
    const m = /^!(\d)/.exec(line);
    if (m) {
      const n = Number(m[1]);
      return { text: line.slice(2), color: n >= 0 && n <= 6 ? n : defaultColor };
    }
    return { text: line, color: defaultColor };
  });
}
