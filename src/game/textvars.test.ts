import { describe, it, expect } from 'vitest';
import { expandText } from './textvars';

describe('expandText', () => {
  const vars: Record<string, string> = { wood: '7', stone: '12' };
  const get = (n: string) => vars[n] ?? '0';
  it('replaces key names, variables and keeps escaped dollars and image lines', () => {
    expect(expandText('Press [$key_use] to pick up', get)).toBe('Press [E] to pick up');
    expect(expandText('Ye have collected $wood logs.', get)).toBe('Ye have collected 7 logs.');
    expect(expandText('Trunks: $wood\nStones: $stone', get)).toBe('Trunks: 7\nStones: 12');
    expect(expandText('costs \\$5', get)).toBe('costs $5');
    expect(expandText('$img=tutorial\\grain.bmp\nmissing $nope', get)).toBe('$img=tutorial\\grain.bmp\nmissing 0');
  });
});
