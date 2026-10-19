// The walk results that come from the level data alone, worked out at build time (data/walk.json, written by
// scripts/build-walk.ts): the static level roles, the floor heights the map draws and the room answers the walker
// uses. The walker and the build script do not import this module, so the build script runs before walk.json exists.
import WALK from '../data/walk.json' with { type: 'json' };
import { inflate, worldReady } from './data.ts';
import type { MapLayerValues, WalkFile } from './types.ts';
import { setRoomAnswers, unpackRooms } from './walk/room-answers.ts';
import type { PackedRoom, StoredRoom } from './walk/room-answers.ts';

const NO_FLOOR = 0;
const FLOOR_OFFSET = 128;

/** The static roles of data/walk.json unpacked: a role per level and per Freezer, and what each sits behind. */
export interface StoredRoles {
    need: { l: Uint8Array; g: Uint8Array };
    bg: WalkFile['roles']['bg'];
}

function storedRoles(roles: WalkFile['roles']): StoredRoles {
    const digits = (text: string) => Uint8Array.from(text, Number);
    return {
        need: { l: digits(roles.need.l), g: digits(roles.need.g) },
        bg: roles.bg,
    };
}

function floorColumns(bytes: Uint8Array): Float32Array {
    const heights = new Float32Array(bytes.length);
    for (let column = 0; column < bytes.length; column++) {
        if (bytes[column] === NO_FLOOR) heights[column] = NaN;
        else heights[column] = bytes[column] - FLOOR_OFFSET;
    }

    return heights;
}

async function storedFloors(floors: MapLayerValues<string>): Promise<MapLayerValues<Float32Array>> {
    const [underworld, ground, sky] = await Promise.all([
        inflate(floors.underworld),
        inflate(floors.ground),
        inflate(floors.sky),
    ]);
    return { underworld: floorColumns(underworld), ground: floorColumns(ground), sky: floorColumns(sky) };
}

/** The room answers of data/walk.json unpacked and handed to the walk (setRoomAnswers). */
async function storedRooms(rooms: WalkFile['rooms']): Promise<StoredRoom[]> {
    const json = new TextDecoder().decode(await inflate(rooms.data));
    const packed: PackedRoom[] = JSON.parse(json);
    return unpackRooms(packed);
}

/** The static roles, as staticRoles() (src/model/static-roles.ts) returns them. */
export const STATIC_ROLES = storedRoles(WALK.roles);

/** Per map layer key, as floorHeights() (src/walk/reachability.ts) returns them; null until walkReady. */
export let FLOOR_HEIGHTS: MapLayerValues<Float32Array> | null = null;

/** The world cells, the floor heights and the room answers are unpacked, and the walk uses the room answers. */
export const walkReady: Promise<void> = Promise.all([worldReady, storedFloors(WALK.floors), storedRooms(WALK.rooms)])
    .then(([, floors, rooms]) => {
        FLOOR_HEIGHTS = floors;
        setRoomAnswers(rooms);
    })
    .catch((error) => console.error('walk data', error));
