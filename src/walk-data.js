// The walk results that come from the level data alone, worked out at build time (data/walk.json, written by
// scripts/build-walk.js): the static level roles and the floor heights the map draws. The walker and the build script
// do not import this module, so the build script runs before walk.json exists.
import WALK from '../data/walk.json' with { type: 'json' };
import { inflate, worldReady } from './data.js';

const NO_FLOOR = 0;
const FLOOR_OFFSET = 128;

function storedRoles(roles) {
    const digits = (text) => Uint8Array.from(text, Number);
    return {
        need: { l: digits(roles.need.l), g: digits(roles.need.g) },
        bg: roles.bg,
    };
}

function floorColumns(bytes) {
    const heights = new Float32Array(bytes.length);
    for (let column = 0; column < bytes.length; column++) {
        if (bytes[column] === NO_FLOOR) heights[column] = NaN;
        else heights[column] = bytes[column] - FLOOR_OFFSET;
    }
    return heights;
}

async function storedFloors(floors) {
    const keys = Object.keys(floors);
    const layers = await Promise.all(keys.map((key) => inflate(floors[key])));
    return Object.fromEntries(keys.map((key, n) => [key, floorColumns(layers[n])]));
}

// The static roles, as staticRoles() (src/model/level-roles.js) returns them
export const STATIC_ROLES = storedRoles(WALK.roles);

// Per map layer key, as floorHeights() (src/walk/reachability.js) returns them; null until walkReady
export let FLOOR_HEIGHTS = null;

// The world cells and the floor heights are unpacked
export const walkReady = Promise.all([worldReady, storedFloors(WALK.floors)])
    .then(([, floors]) => {
        FLOOR_HEIGHTS = floors;
    })
    .catch((err) => console.error('walk data', err));
