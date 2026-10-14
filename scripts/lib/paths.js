// Shared locations: the project root and its data/ folder, and the game and save folders.
//
// Game folder: --game, else $SOKO_GAME, else found through the Steam install (registry, then every library in
// libraryfolders.vdf), else the default Steam path. Saves: $SOKO_SAVES, else
// %USERPROFILE%\Saved Games\Order of the Sinking Star.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { savesDir } from '../saves.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_NAME = 'Order of the Sinking Star';
const DEFAULT_STEAM = 'C:\\Program Files (x86)\\Steam';

let gameFolder = null;

function steamRoot() {
    try {
        const output = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        const match = /SteamPath\s+REG_SZ\s+(.+)/.exec(output);
        if (match) return match[1].trim();
    } catch {
        // no Steam registry key (not Windows, or Steam is not installed)
    }
    return null;
}

function steamLibraries() {
    const libraries = [];
    const steam = steamRoot();
    if (steam) {
        libraries.push(steam);
        const vdf = join(steam, 'steamapps', 'libraryfolders.vdf');
        if (existsSync(vdf)) {
            const text = readFileSync(vdf, 'utf8');
            for (const match of text.matchAll(/"path"\s+"([^"]+)"/g)) libraries.push(match[1].replaceAll('\\\\', '\\'));
        }
    }
    libraries.push(DEFAULT_STEAM);
    return libraries;
}

function findGame() {
    if (process.env.SOKO_GAME) return process.env.SOKO_GAME;
    let path = null;
    for (const library of steamLibraries()) {
        path = normalize(join(library, 'steamapps', 'common', GAME_NAME));
        if (existsSync(path) && statSync(path).isDirectory()) return path;
    }
    return path;
}

export function setGame(path) {
    if (path) gameFolder = resolve(path);
}

// A path inside the game folder
export function game(...parts) {
    gameFolder ??= findGame();
    return join(gameFolder, ...parts);
}

// A path inside the saves folder (campaigns are its subfolders, `default` by default)
export function saves(...parts) {
    return join(savesDir(), ...parts);
}

// A path inside data/ (generated and dumped data)
export function data(...parts) {
    return join(ROOT, 'data', ...parts);
}

// Parses the command line, with --game added to the options a script takes, and applies the game folder
export function parseCommandLine(options = {}, allowPositionals = false) {
    const { values, positionals } = parseArgs({
        options: { game: { type: 'string' }, ...options },
        allowPositionals,
    });
    setGame(values.game);
    return { values, positionals };
}
