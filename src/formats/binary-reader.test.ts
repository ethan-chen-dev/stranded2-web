import { describe, it, expect } from 'vitest';
import { BinaryReader } from './binary-reader';

const bytes = (...b: number[]) => new Uint8Array(b);

describe('BinaryReader', () => {
  it('reads little-endian ints and floats', () => {
    const r = new BinaryReader(bytes(0x01, 0x02, 0xff, 0xff, 0x00, 0x00, 0x80, 0x3f));
    expect(r.i16()).toBe(0x0201);
    expect(r.i16()).toBe(-1);
    expect(r.f32()).toBe(1);
    expect(r.eof()).toBe(true);
  });
  it('reads a line and strips CR', () => {
    const r = new BinaryReader(new TextEncoder().encode('abc\r\nrest'));
    expect(r.line()).toBe('abc');
    expect(r.offset).toBe(5);
  });
  it('reads a blitz string with i32 length', () => {
    const r = new BinaryReader(bytes(3, 0, 0, 0, 0x73, 0x6b, 0x79));
    expect(r.bstring()).toBe('sky');
  });
  it('reads cstring and tag', () => {
    const r = new BinaryReader(new TextEncoder().encode('BB3Dname\0'));
    expect(r.tag()).toBe('BB3D');
    expect(r.cstring()).toBe('name');
  });
  it('throws past end', () => {
    expect(() => new BinaryReader(bytes(1)).i32()).toThrow(RangeError);
  });
});
