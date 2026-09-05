import { CommandRegistry } from '../registry';
import { registerCore } from './core';
import { registerEntity } from './entity';
import { registerPlayer } from './player';
import { registerStates } from './states';
import { registerUi } from './ui';

export function createRegistry(): CommandRegistry {
  const r = new CommandRegistry();
  registerCore(r);
  registerEntity(r);
  registerPlayer(r);
  registerStates(r);
  registerUi(r);
  return r;
}
