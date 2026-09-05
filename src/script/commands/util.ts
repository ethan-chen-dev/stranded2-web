/** 指令实现的公共工具：类名解析、参数取值。 */
import { ScriptRuntimeError, toInt, toFloat, fromNumber, type Value } from '../value';
import type { CommandContext } from '../registry';
import { CLASS } from '../host';

const CLASS_NAMES: Record<string, number> = {
  object: CLASS.object, unit: CLASS.unit, item: CLASS.item, info: CLASS.info, state: CLASS.state,
  '1': CLASS.object, '2': CLASS.unit, '3': CLASS.item, '4': CLASS.info, '5': CLASS.state,
};

export function classOf(v: Value): number | undefined {
  return CLASS_NAMES[v.trim().toLowerCase()];
}

export function className(cls: number): string {
  return ['global', 'object', 'unit', 'item', 'info', 'state'][cls] ?? 'unknown class';
}

/**
 * 读取 "class", id 参数对；"self"、-1 或非类名时取当前实体。
 * 返回类、id 与下一个参数下标。
 */
export function classId(ctx: CommandContext, args: Value[], i: number): { cls: number; id: number; next: number } {
  const c = args[i];
  if (c === undefined) return { cls: ctx.env.cls, id: ctx.env.id, next: i };
  const cls = classOf(c);
  if (cls === undefined) return { cls: ctx.env.cls, id: ctx.env.id, next: i + 1 };
  return { cls, id: toInt(args[i + 1] ?? '0'), next: i + 2 };
}

export function requireClass(v: Value, line?: number): number {
  const cls = classOf(v);
  if (cls === undefined) throw new ScriptRuntimeError(`'${v}' is no valid class`, line);
  return cls;
}

export const int = toInt;
export const num = toFloat;
export const str = (n: number): Value => fromNumber(n);
export const flt = (n: number): Value => fromNumber(n, true);
export const bool = (b: boolean): Value => (b ? '1' : '0');
