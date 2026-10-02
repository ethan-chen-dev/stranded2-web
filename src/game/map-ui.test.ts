import { describe, it, expect } from 'vitest';
import { edgeFrame } from './map-ui';

describe('map edge arrows', () => {
  it('picks the arrow frame by the clamped player position like if_map', () => {
    expect(edgeFrame(0, -127)).toBe(1);
    expect(edgeFrame(0, 127)).toBe(5);
    expect(edgeFrame(-127, -127)).toBe(8);
    expect(edgeFrame(127, 127)).toBe(4);
    expect(edgeFrame(127, 0)).toBe(3);
    expect(edgeFrame(-127, 0)).toBe(7);
  });
});
