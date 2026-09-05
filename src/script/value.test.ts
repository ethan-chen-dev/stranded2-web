import { describe, it, expect } from 'vitest';
import { typeOf, toInt, toFloat, fromNumber, add, sub, mul, div, compare, logic, truthy, negate, ScriptRuntimeError } from './value';

describe('value', () => {
  it('classifies types', () => {
    expect(typeOf('12')).toBe(0);
    expect(typeOf('-1.5')).toBe(1);
    expect(typeOf('1a')).toBe(2);
    expect(typeOf('')).toBe(0);
    expect(typeOf('007')).toBe(0);
    expect(typeOf('abc')).toBe(2);
  });
  it('converts like Blitz', () => {
    expect(toInt('12abc')).toBe(12);
    expect(toInt('1.9')).toBe(1);
    expect(toInt('abc')).toBe(0);
    expect(toFloat('2.5x')).toBe(2.5);
    expect(fromNumber(3)).toBe('3');
    expect(fromNumber(3, true)).toBe('3.0');
    expect(fromNumber(2.5)).toBe('2.5');
    expect(fromNumber(1 / 3, true)).toBe('0.333333');
  });
  it('adds with concatenation rule', () => {
    expect(add('1', '2')).toBe('3');
    expect(add('a', '1')).toBe('a1');
    expect(add('1.5', '1')).toBe('2.5');
    expect(add('Hi ', 'Bob')).toBe('Hi Bob');
  });
  it('subtracts, multiplies, divides', () => {
    expect(sub('5', '7')).toBe('-2');
    expect(mul('3', '4')).toBe('12');
    expect(mul('1.5', '2')).toBe('3.0');
    expect(div('3', '2')).toBe('1');
    expect(div('3.0', '2')).toBe('1.5');
    expect(() => div('1', '0')).toThrow(ScriptRuntimeError);
  });
  it('compares', () => {
    expect(compare('==', 'abc', 'abc')).toBe('1');
    expect(compare('==', '1', '1.0')).toBe('1');
    expect(compare('==', '01', '1')).toBe('1');
    expect(compare('!=', 'a', 'b')).toBe('1');
    expect(compare('<', '2', '10')).toBe('1');
    expect(compare('>=', '2.5', '2')).toBe('1');
    expect(compare('=>', '3', '3')).toBe('1');
    expect(compare('<', '2', 'abc')).toBe('0');
  });
  it('logic and truthiness', () => {
    expect(logic('&&', '1', '0')).toBe('0');
    expect(logic('||', '0', '2')).toBe('1');
    expect(logic('xor', '1', '1')).toBe('0');
    expect(truthy('0')).toBe(false);
    expect(truthy('abc')).toBe(false);
    expect(truthy('3')).toBe(true);
    expect(negate('5')).toBe('-5');
    expect(negate('1.5')).toBe('-1.5');
  });
});
