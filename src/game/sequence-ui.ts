/** 序列覆盖层：黑边、三条字幕、纯色遮盖、淡入淡出、闪光、居中图片与图片文字。 */
import type { Sequence } from './sequence';
import { assetUrl } from '../assets/paths';

/** 原版 800x600 画面下黑边像素换算为视口高度比例。 */
const BASE_HEIGHT = 600;
const FONT_COLORS = ['#ffffff', '#88ff88', '#ff8888', '#ffee88', '#aaaaaa', '#88ff88', '#ff8888'];

export class SequenceUi {
  private readonly root: HTMLElement;
  private readonly barTop: HTMLElement;
  private readonly barBottom: HTMLElement;
  private readonly clsEl: HTMLElement;
  private readonly fadeEl: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly imageWrap: HTMLElement;
  private readonly imageEl: HTMLImageElement;
  private readonly msgEls: HTMLElement[];
  private imagePath = '';
  private imageTextCount = -1;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'seq';
    this.root.hidden = true;
    this.clsEl = document.createElement('div');
    this.clsEl.className = 'seq-cls';
    this.imageWrap = document.createElement('div');
    this.imageWrap.className = 'seq-image';
    this.imageEl = document.createElement('img');
    this.imageEl.alt = '';
    this.imageWrap.append(this.imageEl);
    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'seq-fade';
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'seq-fade';
    this.barTop = document.createElement('div');
    this.barTop.className = 'seq-bar seq-bar-top';
    this.barBottom = document.createElement('div');
    this.barBottom.className = 'seq-bar seq-bar-bottom';
    this.msgEls = ['seq-msg-bottom', 'seq-msg-top', 'seq-msg-middle'].map(cls => {
      const el = document.createElement('div');
      el.className = `seq-msg ${cls}`;
      return el;
    });
    this.root.append(this.clsEl, this.imageWrap, this.fadeEl, this.flashEl, this.barTop, this.barBottom, ...this.msgEls);
    parent.append(this.root);
  }

  render(seq: Sequence): void {
    const show = seq.active || seq.barPx > 0;
    this.root.hidden = !show;
    if (!show) return;
    const barVh = (seq.barPx / BASE_HEIGHT) * 100;
    this.barTop.style.height = `${barVh}vh`;
    this.barBottom.style.height = `${barVh}vh`;
    this.clsEl.hidden = !seq.cls.on;
    if (seq.cls.on) this.clsEl.style.background = `rgb(${seq.cls.r},${seq.cls.g},${seq.cls.b})`;
    const fade = seq.active ? seq.fadeColor() : null;
    this.fadeEl.hidden = !fade;
    if (fade) this.fadeEl.style.background = `rgba(${fade.r},${fade.g},${fade.b},${fade.a.toFixed(3)})`;
    const flash = seq.active ? seq.flashColor() : null;
    this.flashEl.hidden = !flash;
    if (flash) this.flashEl.style.background = `rgba(${flash.r},${flash.g},${flash.b},${flash.a.toFixed(3)})`;
    const path = seq.active && seq.image ? seq.image.path : '';
    if (path !== this.imagePath) {
      this.imagePath = path;
      this.imageTextCount = -1;
      this.imageEl.src = path ? encodeURI(assetUrl(path)) : '';
    }
    this.imageWrap.hidden = !path;
    if (path && seq.imageTexts.length !== this.imageTextCount) {
      this.imageTextCount = seq.imageTexts.length;
      for (const old of this.imageWrap.querySelectorAll('.seq-itxt')) old.remove();
      for (const t of seq.imageTexts) {
        const el = document.createElement('div');
        el.className = 'seq-itxt';
        el.textContent = t.text;
        el.style.left = `${t.x}px`;
        el.style.top = `${t.y}px`;
        el.style.color = FONT_COLORS[t.color] ?? FONT_COLORS[0];
        el.style.transform = t.align === 1 ? 'translateX(-50%)' : t.align === 2 ? 'translateX(-100%)' : '';
        this.imageWrap.append(el);
      }
    }
    seq.msgs.forEach((m, i) => {
      const el = this.msgEls[i];
      const text = seq.active && m ? m.text : '';
      if (el.textContent !== text) el.textContent = text;
      el.style.color = FONT_COLORS[m?.color ?? 0] ?? FONT_COLORS[0];
    });
  }

  dispose(): void {
    this.root.remove();
  }
}
