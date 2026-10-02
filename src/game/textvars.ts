/**
 * 界面文字里的占位符，依据 load_bmpf.bb 的 bmpf_txt 与 parser_vars.bb 的 var_rep：
 * 先把列出的 $key_xxx 换成按键名，再把其余 $变量 换成变量值（反斜杠转义的 \$ 原样保留），
 * 以 $img= 开头的行是内嵌图片，留给面板绘制。
 */
const KEY_NAMES: Record<string, string> = {
  forward: 'W', backward: 'S', left: 'A', right: 'D', jump: 'Space', sleep: 'Y',
  attack1: 'left mouse button', attack2: 'right mouse button', next: 'mouse wheel', prev: 'mouse wheel',
  drop: 'Drop in the inventory', use: 'E', chat: 'Enter', char: 'T', items: 'Tab', diary: 'T',
  quicksave: 'F5', quickload: 'F9',
};

export const IMAGE_PREFIX = '$img=';

/** getVar 取变量值，不存在时返回 '0'（原版 var_get 返回 0）。 */
export function expandText(text: string, getVar: (name: string) => string): string {
  const keyed = text.replace(/\$key_([a-z0-9]+)/g, (m, k: string) => KEY_NAMES[k] ?? m);
  return keyed.split(/(\r?\n|¦)/).map(line => {
    if (line.startsWith(IMAGE_PREFIX)) return line;
    return line.replace(/(\\?)\$([A-Za-z0-9_]+)/g, (_, esc: string, name: string) => (esc ? `$${name}` : getVar(name)));
  }).join('');
}
