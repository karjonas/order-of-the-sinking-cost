// What data/walk.json's `inputs` hashes, and what the stored room answers depend on. The walk's data files are hashed by
// their bytes. The room search runs on the walk code, so its sources are hashed too: room-search.ts and every .ts file it
// imports, directly or through other imports. A change to any of them makes the stored room answers stale.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as paths from './paths.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const ROOM_SEARCH = join(SRC, 'walk', 'room-search.ts');
const DATA_INPUTS = ['progress.json', 'world.json'];
const ROOM_SEARCH_KEY = 'room-search sources';
const IMPORT_PATH = /from '(\.{1,2}\/[^']+)'/g;

function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

/** The source files the room search runs on: room-search.ts and the .ts files it imports, transitively. */
function roomSearchSources() {
    const found = new Set();
    const pending = [ROOM_SEARCH];

    while (pending.length > 0) {
        const file = pending.pop();
        if (found.has(file)) continue;
        found.add(file);

        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(IMPORT_PATH)) {
            const target = resolve(dirname(file), match[1]);
            if (target.endsWith('.ts')) pending.push(target);
        }
    }

    return [...found].toSorted();
}

function roomSearchHash() {
    const hash = createHash('sha256');

    for (const file of roomSearchSources()) {
        hash.update(relative(SRC, file));
        hash.update('\0');
        hash.update(readFileSync(file));
        hash.update('\0');
    }

    return hash.digest('hex');
}

/** The inputs of data/walk.json: the SHA-256 of each data file, and the SHA-256 of the room search's sources. */
export function walkInputs() {
    const inputs = {};

    for (const name of DATA_INPUTS) inputs[name] = sha256(readFileSync(paths.data(name)));
    inputs[ROOM_SEARCH_KEY] = roomSearchHash();

    return inputs;
}
