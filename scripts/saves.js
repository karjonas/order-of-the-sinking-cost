// The game's save folder: $SOKO_SAVES, else %USERPROFILE%\Saved Games\Order of the Sinking Star
import { homedir } from 'node:os';
import { join } from 'node:path';

export const savesDir = () => process.env.SOKO_SAVES || join(homedir(), 'Saved Games', 'Order of the Sinking Star');
