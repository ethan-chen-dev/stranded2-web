import { describe, it, expect } from 'vitest';
import { SoundSets } from './soundsets';

describe('SoundSets', () => {
  it('maps set and event to the wav file or the file an .inf redirects to', async () => {
    const sets = await SoundSets.load(['Lion_spot.wav', 'raptor_move.inf', 'raptor_attack.wav', 'step1.wav'], async name => (name === 'raptor_move.inf' ? 'normalsteps.wav\r\n' : ''));
    expect(sets.file('lion', 'spot')).toBe('Lion_spot.wav');
    expect(sets.file('raptor', 'move')).toBe('normalsteps.wav');
    expect(sets.file('raptor', 'die')).toBeNull();
    expect(sets.file('', 'move')).toBeNull();
  });
});
