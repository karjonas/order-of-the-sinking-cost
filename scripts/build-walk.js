// Writes data/walk.json: what the walk model works out from the level data alone, so the page does not redo it on
// every load.
//
// Reads data/progress.json (the world cells come in through it from data/world.json); writes data/walk.json.
//
// Usage: node scripts/build-walk.js [--game DIR]
//
// Output (docs/VIEWER.md "The walk model (viewer)" and "Level roles (viewer)"):
//   inputs: per input file name (in data/), the SHA-256 of its bytes; tests/walk-data.test.js fails when they no
//     longer match, or when the walk on the current code gives other results
//   roles: staticRoles() (src/model/static-roles.ts). need.l / need.g: one digit per level / Freezer, 2 Required, 1 Required as
//     one of several, 0 Optional; bg.l / bg.g: per level / Freezer, the Freezers it sits behind
//   floors: floorHeights() (src/walk/reachability.ts), per map layer key a zlib stream (base64) of one byte per map column (row 0 =
//     north): the highest z where the hero can stand there plus 128, 0 where he stands nowhere
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { worldReady } from '../src/data.ts';
import { staticRoles } from '../src/model/static-roles.ts';
import { floorHeights } from '../src/walk/reachability.ts';
import { writeJsonAtomic } from './lib/output.js';
import * as paths from './lib/paths.js';

const INPUTS = ['progress.json', 'world.json'];
const NO_FLOOR = 0;
const FLOOR_OFFSET = 128;

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function inputHashes() {
    return Object.fromEntries(INPUTS.map((name) => [name, sha256(paths.data(name))]));
}

function packedRoles(roles) {
    const digits = (need) => [...need].join('');
    return {
        need: { l: digits(roles.need.l), g: digits(roles.need.g) },
        bg: roles.bg,
    };
}

function floorByte(z) {
    if (Number.isNaN(z)) return NO_FLOOR;
    const value = z + FLOOR_OFFSET;
    if (!Number.isInteger(value) || value <= NO_FLOOR || value > 255) throw new Error(`floor height ${z} has no byte`);
    return value;
}

function packedFloors(heights) {
    const out = {};
    for (const [key, columns] of Object.entries(heights)) {
        const bytes = Uint8Array.from(columns, floorByte);
        out[key] = deflateSync(bytes, { level: 9 }).toString('base64');
    }
    return out;
}

async function main() {
    paths.parseCommandLine();
    await worldReady;
    const roles = staticRoles();
    if (!roles) throw new Error('no static roles: progress.json has no world cells or no start position');
    const heights = floorHeights();
    if (!heights) throw new Error('no floor heights: progress.json has no world cells');
    const out = {
        inputs: inputHashes(),
        roles: packedRoles(roles),
        floors: packedFloors(heights),
    };
    const walkPath = paths.data('walk.json');
    writeJsonAtomic(walkPath, out);
    const required = [...roles.need.l].filter((need) => need > 0).length;
    console.log(
        `levels ${roles.need.l.length} required ${required} gates ${roles.need.g.length} ` +
            `floor layers ${Object.keys(heights).length} bytes ${statSync(walkPath).size}`,
    );
}

await main();
