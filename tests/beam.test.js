// THROUGH beams on a tiny synthetic overworld: a hero walks through walls only inside a powered beam
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PROG, WORLD } from '../src/data.ts';
import { reachability } from '../src/walk/reachability.ts';
import { walker } from '../src/walk/walker.ts';

vi.mock('../src/data.ts', async () => {
    const SCHEMA = (await import('../data/schema.json')).default;
    return { SCHEMA, PROG: {}, WORLD: {}, worldReady: Promise.resolve() };
});
vi.mock('../src/walk-data.ts', () => ({ STATIC_ROLES: null, FLOOR_HEIGHTS: null, walkReady: Promise.resolve() }));

const Z_OFFSET = 64,
    LIGHT = 7,
    SLOT = 8,
    GEM = 11;
// A `width` x 3 grid at z = 0 on the implicit ground floor. Rows 0 and 2 are wall except the pocket (3, 0); row 1 is
// open but for `walls`. A THROUGH light at (0, 1) faces east; its beam ends where it began.
function world({
    width = 8,
    walls = [
        [3, 1],
        [4, 1],
        [7, 1],
    ],
    extra = {},
} = {}) {
    const height = 3,
        solid = new Set(walls.map(([i, j]) => i + j * width));
    for (let i = 0; i < width; i++) for (const j of [0, 2]) if (!(i === 3 && j === 0)) solid.add(i + j * width);
    const columns = [];
    for (let column = 0; column < width * height; column++) columns.push(...(solid.has(column) ? [1, Z_OFFSET] : [0]));
    Object.assign(WORLD, {
        solid: Uint8Array.from(columns),
        groups: new Uint8Array(0),
        water: new Uint8Array(width * height),
    });
    Object.assign(PROG, {
        levels: [],
        teleporters: [],
        freezers: [],
        map: { size: [width, height], corner: [0, 0], layers: [{ key: 'ground', z: [-8, 8] }] },
        world: {
            grid: { corner: [0, 0], size: [width, height], zoff: Z_OFFSET },
            zlayer: Array.from({ length: 256 }, () => 0),
            groups: [],
            rocks: [],
            lilies: [],
            floors: [],
            switches: [],
            gates: [],
            fences: [],
            oceans: [],
            elevators: [],
            wardrobes: [],
            monsters: [],
            beam_stops: [],
            mechs: [],
            area_pins: [],
            guy: [0, 0],
            lights: [[LIGHT, 0, 1, 0, 0, 0, 0, 0, 1]],
            // the room's one Gem_Slot, not BEAM_POWERED in the level data
            gem_slots: [[SLOT, 0, 1, 0, 0]],
            movables: [],
            ...extra,
        },
    });
}
// latest values: whether the slot's `flags` hold BEAM_POWERED (1) or not (0), none when undefined
const latest = (powered) => ({
    get: (pid, field) => {
        if (pid !== SLOT || field !== 'flags' || powered === undefined) return undefined;
        return Uint8Array.of(powered ? 2 : 0);
    },
    ocean: [],
    created: new Map(),
});
const walk = (powered) => walker(latest(powered), [], []);
const cells = (walkGrid, cellSet) =>
    [...cellSet]
        .map((cell) => [cell % walkGrid.width, Math.floor(cell / walkGrid.width) % 3])
        .toSorted((first, second) => first[1] - second[1] || first[0] - second[0])
        .map((point) => point.join());
const flood = (walkGrid, i, j) => cells(walkGrid, walkGrid.flood([walkGrid.cellOf(i, j, 0)]));

describe('THROUGH beam', () => {
    beforeEach(() => world());
    test('a powered beam runs through walls to its first stop', () => {
        const walkGrid = walk(1);
        expect(cells(walkGrid, walkGrid.beam)).toEqual(['1,1', '2,1', '3,1', '4,1', '5,1', '6,1', '7,1']);
        expect(cells(walkGrid, walkGrid.thru)).toEqual(['3,1', '4,1', '7,1']);
        expect(flood(walkGrid, 1, 1)).toEqual(['3,0', '0,1', '1,1', '2,1', '3,1', '4,1', '5,1', '6,1', '7,1']);
    });
    test('a beam wall cell is entered only from the beam', () => {
        expect(flood(walk(1), 3, 0)).toEqual(['3,0']);
    });
    test('an unpowered light casts no beam', () => {
        for (const walkGrid of [walk(0), walk(undefined)]) {
            expect(walkGrid.beam.size).toBe(0);
            expect(flood(walkGrid, 1, 1)).toEqual(['0,1', '1,1', '2,1']);
        }
    });
    test('the save overrides the level-data slot flags', () => {
        PROG.world.gem_slots[0][4] = 1;
        expect(walk(undefined).beam.size).toBe(7);
        expect(walk(0).beam.size).toBe(0);
    });
    test("the room powers the light, whatever the light's own powered says", () => {
        PROG.world.lights[0][7] = 1;
        expect(walk(undefined).beam.size).toBe(0);
        world({ extra: { gem_slots: [] } });
        PROG.world.lights[0][7] = 1;
        expect(walk(undefined).beam.size).toBe(0);
    });
    test('a free Gem on the slot fills it; a held one or one elsewhere does not', () => {
        world({ extra: { movables: [[GEM, 0, 1, 0, 0]] } });
        expect(walk(undefined).beam.size).toBe(7);
        world({ extra: { movables: [[GEM, 0, 1, 0, 0]], held_gems: [GEM] } });
        expect(walk(undefined).beam.size).toBe(0);
        world({ extra: { movables: [[GEM, 1, 1, 0, 0]] } });
        expect(walk(undefined).beam.size).toBe(0);
    });
    test('every existing slot of the room must be filled; one in another room does not count', () => {
        world({
            extra: {
                movables: [[GEM, 0, 1, 0, 0]],
                gem_slots: [
                    [SLOT, 0, 1, 0, 0],
                    [12, 5, 1, 0, 0],
                ],
            },
        });
        expect(walk(undefined).beam.size).toBe(0);
        world({
            extra: {
                movables: [[GEM, 0, 1, 0, 0]],
                gem_slots: [
                    [SLOT, 0, 1, 0, 0],
                    [12, 5, 1, 0, 0, 0],
                ],
            },
        });
        expect(walk(undefined).beam.size).toBe(7);
        world({
            width: 40,
            walls: [],
            extra: {
                movables: [[GEM, 0, 1, 0, 0]],
                gem_slots: [
                    [SLOT, 0, 1, 0, 0],
                    [12, 25, 1, 0, 0],
                ],
            },
        });
        expect(walk(undefined).beam.size).toBe(39);
    });
    test.each([
        ['a beam stop', { beam_stops: [[2, 1, 0]] }],
        ['a Rock', { rocks: [[9, 2, 1, 0]] }],
        ['a shut Gate', { gates: [[9, 2, 1, 0, 0, 0, 0, 0, 5]] }],
    ])('%s ends the beam', (name, extra) => {
        world({ extra });
        const walkGrid = walk(1);
        expect(cells(walkGrid, walkGrid.beam)).toEqual(['1,1']);
        expect(walkGrid.thru.size).toBe(0);
    });
    test('Monsters do not end the beam', () => {
        world({ extra: { monsters: [[9, 2, 1, 0, -2]] } });
        const walkGrid = walk(1);
        expect(cells(walkGrid, walkGrid.thru)).toEqual(['3,1', '4,1', '7,1']);
    });
    test('a beam runs one lap of the world at most, ending at its own light', () => {
        world({ width: 150, walls: [] });
        expect(walk(1).beam.size).toBe(149);
    });
    test('a hero position inside a wall no beam runs through is a dead seed', () => {
        const historyOf = (heroes) => ({
            hero: null,
            heroes: new Map(heroes.map((position) => [position.join(), position])),
            actions: [],
        });
        const dead = (powered, heroes) => reachability(historyOf(heroes), latest(powered), [], [], []).dead;
        // (2, 0) is wall; (3, 1) is wall in the beam
        expect(
            dead(1, [
                [2, 0, 0],
                [3, 1, 0],
                [1, 1, 0],
            ]),
        ).toBe(1);
        expect(
            dead(0, [
                [2, 0, 0],
                [3, 1, 0],
                [1, 1, 0],
            ]),
        ).toBe(2);
    });
});

describe('vertical beam', () => {
    // an OPEN light at (0, 1) facing up, with the walk's layers split at z 5 and the map rooms from z 10
    const zOf = (walkGrid, cell) => Math.floor(cell / (walkGrid.width * 3)) - 80;
    beforeEach(() => {
        world();
        PROG.world.lights = [[LIGHT, 0, 1, 0, -1, 1, 0, 0, 0]];
        PROG.world.zlayer = Array.from({ length: 256 }, (_, z) => (z - Z_OFFSET >= 5 ? 1 : 0));
        PROG.world.grid.ft = { z: 10, size: [8, 3], corner: [0, 0] };
    });
    test('leaves its layer and climbs to half a cell under the map rooms', () => {
        const zValues = [...walk(1).openBeam].map((cell) => zOf(walk(1), cell));
        expect(Math.min(...zValues)).toBe(1);
        expect(Math.max(...zValues)).toBe(9);
        expect(zValues.length).toBe(9);
    });
    test('solid voxels do not stop it', () => {
        // the light's column (0, 1) holds solid voxels at z 3 and 4; every other column is open ground
        const columns = [];
        for (let column = 0; column < 24; column++)
            columns.push(...(column === 8 ? [2, Z_OFFSET + 3, Z_OFFSET + 4] : [0]));
        WORLD.solid = Uint8Array.from(columns);
        expect(walk(1).openBeam.size).toBe(9);
    });
});
