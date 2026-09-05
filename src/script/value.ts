/**
 * S2 脚本值语义：值都是字符串，按内容分整数、浮点、字符串三类；
 * 运算规则与原版 parser_math.bb 一致。
 */
export type Value = string;

export class ScriptRuntimeError extends Error {
  constructor(message: string, public line?: number) {
    super(message);
    this.name = 'ScriptRuntimeError';
  }
}

/** 0 整数、1 浮点、2 字符串。空串视为整数 0。 */
export function typeOf(v: Value): 0 | 1 | 2 {
  if (v === '') return 0;
  if (/^-?\d+$/.test(v)) return 0;
  if (/^-?[\d.]*$/.test(v)) return v.includes('.') ? 1 : 0;
  return 2;
}

/** Blitz Int：取前导整数部分，失败为 0。 */
export function toInt(v: Value): number {
  const m = /^\s*(-?\d+)/.exec(v);
  if (m) return parseInt(m[1], 10);
  const f = /^\s*(-?\.\d+)/.exec(v);
  return f ? Math.trunc(parseFloat(f[1])) : 0;
}

export function toFloat(v: Value): number {
  const m = /^\s*(-?(?:\d+\.?\d*|\.\d+))/.exec(v);
  return m ? parseFloat(m[1]) : 0;
}

/** Blitz Str：整数不带小数点；浮点保留最多 6 位小数并去掉多余的零，但至少保留一位。 */
export function fromNumber(n: number, float = false): Value {
  if (!float && Number.isInteger(n)) return String(n);
  if (!Number.isFinite(n)) return '0';
  let s = n.toFixed(6);
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s += '0';
  return s;
}

function bothInt(a: Value, b: Value): boolean {
  return typeOf(a) === 0 && typeOf(b) === 0;
}

export function add(a: Value, b: Value): Value {
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta === 0 && tb === 0) return fromNumber(toInt(a) + toInt(b));
  if (ta === 2 || tb === 2) return a + b;
  return fromNumber(toFloat(a) + toFloat(b), true);
}

export function sub(a: Value, b: Value): Value {
  if (bothInt(a, b)) return fromNumber(toInt(a) - toInt(b));
  return fromNumber(toFloat(a) - toFloat(b), true);
}

export function mul(a: Value, b: Value): Value {
  if (bothInt(a, b)) return fromNumber(toInt(a) * toInt(b));
  return fromNumber(toFloat(a) * toFloat(b), true);
}

export function div(a: Value, b: Value): Value {
  if (toFloat(b) === 0) throw new ScriptRuntimeError(`division by zero '${a}/${b}'`);
  if (bothInt(a, b)) return fromNumber(Math.trunc(toInt(a) / toInt(b)));
  return fromNumber(toFloat(a) / toFloat(b), true);
}

export function compare(op: string, a: Value, b: Value): Value {
  const ta = typeOf(a);
  const tb = typeOf(b);
  let r: boolean;
  if (op === '==') {
    if (a === b) r = true;
    else if (ta === 1 || tb === 1) r = toFloat(a) === toFloat(b);
    else if (ta === 0 && tb === 0) r = toInt(a) === toInt(b);
    else r = false;
    return r ? '1' : '0';
  }
  const numeric = ta !== 2 && tb !== 2;
  const useInt = ta === 0 && tb === 0;
  const x = numeric ? (useInt ? toInt(a) : toFloat(a)) : a;
  const y = numeric ? (useInt ? toInt(b) : toFloat(b)) : b;
  switch (op) {
    case '!=': r = x !== y; break;
    case '>': r = numeric ? (x as number) > (y as number) : toFloat(a) > toFloat(b); break;
    case '<': r = numeric ? (x as number) < (y as number) : toFloat(a) < toFloat(b); break;
    case '>=': case '=>': r = numeric ? (x as number) >= (y as number) : toFloat(a) >= toFloat(b); break;
    case '<=': case '=<': r = numeric ? (x as number) <= (y as number) : toFloat(a) <= toFloat(b); break;
    default: throw new ScriptRuntimeError(`'${op}' is no allowed operator`);
  }
  return r ? '1' : '0';
}

export function logic(op: string, a: Value, b: Value): Value {
  const x = toInt(a) !== 0;
  const y = toInt(b) !== 0;
  switch (op) {
    case '&&': case 'and': return x && y ? '1' : '0';
    case '||': case 'or': return x || y ? '1' : '0';
    case 'xor': return x !== y ? '1' : '0';
    default: throw new ScriptRuntimeError(`'${op}' is no allowed operator`);
  }
}

export function truthy(v: Value): boolean {
  return toInt(v) !== 0;
}

export function negate(v: Value): Value {
  if (typeOf(v) === 0) return fromNumber(-toInt(v));
  return fromNumber(-toFloat(v), true);
}
