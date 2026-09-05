/** 页面右侧的加载日志面板。 */
export class Log {
  private readonly list: HTMLElement;
  private readonly counts = { info: 0, warn: 0, error: 0 };
  private readonly summary: HTMLElement;

  constructor(container: HTMLElement) {
    container.classList.add('log');
    const header = document.createElement('div');
    header.className = 'log-header';
    this.summary = document.createElement('span');
    this.summary.textContent = '日志';
    const toggle = document.createElement('button');
    toggle.textContent = '折叠';
    header.append(this.summary, toggle);
    this.list = document.createElement('div');
    this.list.className = 'log-list';
    container.append(header, this.list);
    toggle.addEventListener('click', () => {
      const hidden = this.list.hidden = !this.list.hidden;
      toggle.textContent = hidden ? '展开' : '折叠';
    });
  }

  info(msg: string): void { this.add('info', msg); }
  warn(msg: string): void { this.add('warn', msg); console.warn(msg); }
  error(msg: string): void { this.add('error', msg); console.error(msg); }

  private add(level: 'info' | 'warn' | 'error', msg: string): void {
    this.counts[level]++;
    const line = document.createElement('div');
    line.className = `log-${level}`;
    line.textContent = msg;
    this.list.append(line);
    this.list.scrollTop = this.list.scrollHeight;
    this.summary.textContent = `日志 warn ${this.counts.warn} error ${this.counts.error}`;
  }
}
