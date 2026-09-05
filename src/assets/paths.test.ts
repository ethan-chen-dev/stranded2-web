import { describe, it, expect } from 'vitest';
import { modUrl, textureCandidates, dirname } from './paths';

describe('paths', () => {
  it('converts blitz paths', () => {
    expect(modUrl('gfx\\palm01.b3d')).toBe('/gfx/palm01.b3d');
    expect(modUrl('skies\\sky')).toBe('/skies/sky');
    expect(modUrl('/gfx/x.bmp')).toBe('/gfx/x.bmp');
  });
  it('dirname', () => {
    expect(dirname('/gfx/palm01.b3d')).toBe('/gfx');
    expect(dirname('/a')).toBe('/');
  });
  it('resolves texture relative to model then gfx', () => {
    expect(textureCandidates('/gfx/palm01.b3d', '.\\leaf02_a.png')).toEqual(['/gfx/leaf02_a.png']);
    expect(textureCandidates('/mods/x/models/a.b3d', 'skin.bmp')).toEqual(['/mods/x/models/skin.bmp', '/gfx/skin.bmp']);
    expect(textureCandidates('/gfx/a.b3d', 'C:\\work\\tex\\skin.bmp')).toEqual(['/gfx/skin.bmp']);
  });
});
