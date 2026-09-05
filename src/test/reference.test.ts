import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { MOD_ROOT, refPath, readRefText } from './reference';

describe('reference data', () => {
  it('mod root exists', () => {
    expect(existsSync(MOD_ROOT)).toBe(true);
    expect(existsSync(refPath('sys/objects.inf'))).toBe(true);
  });
  it('reads latin-1 text with CRLF intact', () => {
    const t = readRefText('sys/objects_palms.inf');
    expect(t.startsWith('####')).toBe(true);
    expect(t).toContain('\r\n');
  });
});
