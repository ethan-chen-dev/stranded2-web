/** S2 脚本词法分析：标点、运算符、数字、带插值的字符串、变量、标识符；跳过注释。 */
import type { StrPart } from './ast';

export type Token =
  | { type: 'punct'; value: string; line: number }
  | { type: 'op'; value: string; line: number }
  | { type: 'num'; value: string; line: number }
  | { type: 'str'; parts: StrPart[]; line: number }
  | { type: 'var'; name: string; line: number }
  | { type: 'ident'; value: string; line: number }
  | { type: 'eof'; line: number };

export class ScriptSyntaxError extends Error {
  constructor(message: string, public readonly line: number) {
    super(`line ${line}: ${message}`);
    this.name = 'ScriptSyntaxError';
  }
}

/** 原版把地图与外部文件里的脚本按行拼接时用的分隔字节（latin-1 的 0xA6）。 */
const LINE_SEPARATOR = '\u00a6';

const TWO_CHAR_OPS = ['==', '!=', '<=', '>=', '=>', '=<', '&&', '||', '+=', '-=', '++', '--'];
const ONE_CHAR_OPS = '+-*/=<>@:';
const PUNCT = '{}(),;';

function isIdentStart(c: string): boolean {
  return /[A-Za-z_]/.test(c);
}

function isIdentChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    if (c === '\n' || c === LINE_SEPARATOR) { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n' && src[i] !== LINE_SEPARATOR) i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"') {
      const parts: StrPart[] = [];
      let buf = '';
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && src[i + 1] === '$') { buf += '$'; i += 2; continue; }
        if (src[i] === '$') {
          let j = i + 1;
          while (j < n && isIdentChar(src[j])) j++;
          if (j > i + 1) {
            if (buf) { parts.push(buf); buf = ''; }
            parts.push({ var: src.slice(i + 1, j) });
            i = j;
            continue;
          }
        }
        if (src[i] === '\n') line++;
        buf += src[i++];
      }
      if (i >= n) throw new ScriptSyntaxError('unterminated string', line);
      i++;
      if (buf || parts.length === 0) parts.push(buf);
      tokens.push({ type: 'str', parts, line });
      continue;
    }
    if (c === '$') {
      let j = i + 1;
      while (j < n && isIdentChar(src[j])) j++;
      if (j === i + 1) throw new ScriptSyntaxError('$ without variable name', line);
      tokens.push({ type: 'var', name: src.slice(i + 1, j), line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      tokens.push({ type: 'num', value: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i;
      while (j < n && isIdentChar(src[j])) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j), line });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      tokens.push({ type: 'op', value: two, line });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(c)) {
      tokens.push({ type: 'op', value: c, line });
      i++;
      continue;
    }
    if (PUNCT.includes(c)) {
      tokens.push({ type: 'punct', value: c, line });
      i++;
      continue;
    }
    throw new ScriptSyntaxError(`unexpected character ${JSON.stringify(c)}`, line);
  }
  tokens.push({ type: 'eof', line });
  return tokens;
}
