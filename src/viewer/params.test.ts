import { describe, it, expect } from 'vitest';
import { resolveMapPath } from './params';

describe('resolveMapPath', () => {
  const known = ['maps/adventure/map02.s2', 'maps/Survival Guide.s2'];
  it('accepts known maps regardless of case and slashes', () => {
    expect(resolveMapPath('maps\\Adventure\\MAP02.s2', known)).toBe('maps/adventure/map02.s2');
    expect(resolveMapPath('/maps/survival guide.s2', known)).toBe('maps/Survival Guide.s2');
  });
  it('rejects anything else, including markup', () => {
    expect(resolveMapPath('maps/adventure/map09.s2', known)).toBeNull();
    expect(resolveMapPath('<img src=x onerror=alert(1)>', known)).toBeNull();
  });
});
