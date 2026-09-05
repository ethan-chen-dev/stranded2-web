/** Blitz3D 文件流的读取原语：小端整数与浮点，latin-1 文本。 */
export class BinaryReader {
  offset = 0;
  readonly length: number;
  private readonly view: DataView;
  private readonly bytesArr: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytesArr = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.length = bytes.byteLength;
  }

  eof(): boolean {
    return this.offset >= this.length;
  }

  private need(n: number): void {
    if (this.offset + n > this.length) {
      throw new RangeError(`read past end at offset ${this.offset}`);
    }
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const v = this.bytesArr.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }

  /** 读到 \n 为止（不含），去掉尾部 \r；文件末尾无换行时读到末尾。 */
  line(): string {
    let end = this.offset;
    while (end < this.length && this.bytesArr[end] !== 0x0a) end++;
    let text = latin1(this.bytesArr.subarray(this.offset, end));
    if (text.endsWith('\r')) text = text.slice(0, -1);
    this.offset = Math.min(end + 1, this.length);
    return text;
  }

  /** Blitz3D WriteString 格式：i32 长度 + 字节。 */
  bstring(): string {
    const n = this.i32();
    if (n < 0) throw new RangeError(`negative string length at offset ${this.offset - 4}`);
    return latin1(this.bytes(n));
  }

  cstring(): string {
    let end = this.offset;
    while (end < this.length && this.bytesArr[end] !== 0) end++;
    const text = latin1(this.bytesArr.subarray(this.offset, end));
    this.offset = Math.min(end + 1, this.length);
    return text;
  }

  tag(): string {
    return latin1(this.bytes(4));
  }
}

export function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
