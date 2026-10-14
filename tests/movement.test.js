// Fire, pushes, elevators and rock bridges on tiny synthetic overworlds (one row of cells)
import { describe, expect, test, vi } from 'vitest';
import { PROG, WORLD } from '../src/data.js';
import { walker } from '../src/walk/walker.js';

vi.mock('../src/data.js', async () => {
    const SCHEMA = (await import('../data/schema.json')).default;
    return { SCHEMA, PROG: {}, WORLD: {}, worldReady: Promise.resolve() };
});
vi.mock('../src/walk-data.js', () => ({ STATIC_ROLES: null, FLOOR_HEIGHTS: null, walkReady: Promise.resolve() }));

const Z_OFFSET = 64;
// A `width` x 1 row; walls: per column the solid z values; water: per column the indices into extra.oceans
function world(width, walls = {}, extra = {}, water = {}) {
    const columns = [],
        wet = [];
    for (let i = 0; i < width; i++) {
        const heights = walls[i] || [],
            oceanIndexes = water[i] || [];
        columns.push(heights.length, ...heights.map((z) => z + Z_OFFSET));
        wet.push(oceanIndexes.length, ...oceanIndexes.flatMap((oceanIndex) => [oceanIndex & 255, oceanIndex >> 8]));
    }
    Object.assign(WORLD, { solid: Uint8Array.from(columns), groups: new Uint8Array(0), water: Uint8Array.from(wet) });
    Object.assign(PROG, {
        levels: [],
        teleporters: [],
        freezers: [],
        world: {
            grid: { corner: [0, 0], size: [width, 1], zoff: Z_OFFSET },
            zlayer: Array.from({ length: 256 }, () => 0),
            groups: [],
            rocks: [],
            trees: [],
            lilies: [],
            floors: [],
            switches: [],
            gates: [],
            fences: [],
            oceans: [],
            elevators: [],
            wardrobes: [],
            monsters: [],
            movables: [],
            blockers: [],
            beam_stops: [],
            lights: [],
            bridges: [],
            mechs: [],
            area_pins: [],
            guy: [0, 0],
            // a BEAM_POWERED Gem_Slot powers the room, so every light here casts its beam
            gem_slots: [[90, 0, 0, 0, 1]],
            ...extra,
        },
    });
}
const NONE = { get: () => undefined, ocean: [], created: new Map() };
const xs = (walkGrid, cellSet, z) =>
    [...cellSet]
        .filter((cell) => Math.floor(cell / walkGrid.layerCells) - 80 === z)
        .map((cell) => cell % walkGrid.width)
        .toSorted((first, second) => first - second);
const fill = (walkGrid, i, z, protection = 0) => walkGrid.flood([[walkGrid.cellOf(i, 0, z), protection]]);
// walls under every column at z 0, so the hero walks at z 1; column `width` - 1 a high wall that stops the wrap
const floor = (width, more = {}) => ({
    ...Object.fromEntries(Array.from({ length: width }, (_, i) => [i, [0]])),
    [width - 1]: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    ...more,
});

describe('fire', () => {
    // a goblin at column 4 attacks columns 3 and 5 and the cells above and below it
    const goblin = { monsters: [[9, 4, 0, 1, -1]] };
    test('a goblin attacks the 6 cells next to it, above and below included', () => {
        world(8, floor(8, { 4: [] }), goblin);
        const walkGrid = walker(NONE, [], []);
        expect([1, 2].map((z) => xs(walkGrid, walkGrid.fire, z))).toEqual([[3, 5], [4]]);
        expect(xs(walkGrid, walkGrid.fire, 0)).toEqual([4]);
    });
    test('a hero without PROTECTION does not enter an attacked cell; one with it does', () => {
        world(8, floor(8), goblin);
        const walkGrid = walker(NONE, [], []);
        expect(xs(walkGrid, fill(walkGrid, 0, 1), 1)).toEqual([0, 1, 2]);
        expect(xs(walkGrid, fill(walkGrid, 0, 1, 1), 1)).toContain(3);
    });
});

describe('pushes', () => {
    test('a push into a wall blocks the step', () => {
        world(8, floor(8, { 4: [0, 1] }), { rocks: [[9, 3, 0, 1]] });
        const walkGrid = walker(NONE, [], []);
        expect(xs(walkGrid, fill(walkGrid, 0, 1), 1)).toEqual([0, 1, 2]);
    });
    test('a push into open space lets the hero through', () => {
        world(8, floor(8), { rocks: [[9, 3, 0, 1]] });
        const walkGrid = walker(NONE, [], []);
        expect(xs(walkGrid, fill(walkGrid, 0, 1), 1)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
    test('a push into another pushable blocks the step', () => {
        world(8, floor(8), { rocks: [[9, 3, 0, 1]], movables: [[10, 4, 0, 1, 0]] });
        const walkGrid = walker(NONE, [], []);
        expect(xs(walkGrid, fill(walkGrid, 0, 1), 1)).toEqual([0, 1, 2]);
    });
    test('a Sign blocks the hero and holds him up', () => {
        world(8, floor(8, { 5: [] }), {
            blockers: [
                [10, 3, 0, 1],
                [11, 5, 0, 0],
            ],
        });
        const walkGrid = walker(NONE, [], []);
        expect(xs(walkGrid, fill(walkGrid, 0, 1), 1)).toEqual([0, 1, 2]);
        expect(xs(walkGrid, fill(walkGrid, 4, 1), 1)).toEqual([4, 5, 6]);
    });
});

describe('elevators', () => {
    // frames at column 2, z 1 and z 5; columns 3-4 are walls up to z 4, so the hero walks on at z 5 from the top
    const walls = floor(7, { 3: [0, 1, 2, 3, 4], 4: [0, 1, 2, 3, 4] });
    const lift = (mask) => ({ elevators: [[2, 0, 1, 2, 0, 5, mask, 20, -1, 21, -1]] });
    test('mask bit 1 rides up from the bottom frame to the top frame itself', () => {
        world(7, walls, lift(1));
        const walkGrid = walker(NONE, [], []);
        expect(xs(walkGrid, fill(walkGrid, 0, 1), 5)).toEqual([2, 3, 4]);
    });
    test('without bit 1 the bottom frame leads nowhere; bit 2 rides down from the top', () => {
        world(7, walls, lift(2));
        const walkGrid = walker(NONE, [], []);
        expect(xs(walkGrid, fill(walkGrid, 0, 1), 5)).toEqual([]);
        expect(xs(walkGrid, fill(walkGrid, 4, 5), 1)).toEqual([0, 1, 2, 5]);
    });
    test('mask 0 links nothing', () => {
        world(7, walls, lift(0));
        const walkGrid = walker(NONE, [], []);
        expect(xs(walkGrid, fill(walkGrid, 0, 1), 5)).toEqual([]);
    });
});

describe('rock bridges', () => {
    // ground at z 0 (the implicit floor) but for a water channel at columns 4-5, a wall at 9; Rocks at 2 and on the wall
    const run = (bridges) => {
        world(
            10,
            { 9: [0, 1] },
            {
                oceans: [[30, 0, 0, 4, 0, 2, 1]],
                rocks: [
                    [40, 2, 0, 0],
                    [41, 9, 0, 2],
                ],
                bridges,
            },
            { 4: [0], 5: [0] },
        );
        const walkGrid = walker(NONE, [], []);
        return xs(walkGrid, fill(walkGrid, 0, 0), 0);
    };
    test('no bridge: the water stops the walk', () => {
        expect(run([])).toEqual([0, 1, 2, 3]);
    });
    test('a Rock bridges one water cell, however many ways it has', () => {
        expect(
            run([
                [40, 1, 0, 0, 4, 0, 0],
                [40, 1, 0, 0, 5, 0, 0],
            ]),
        ).toEqual([0, 1, 2, 3, 4]);
    });
    test('two Rocks bridge two cells', () => {
        expect(
            run([
                [40, 1, 0, 0, 4, 0, 0],
                [41, 2, 0, 0, 5, 0, 0],
            ]),
        ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });
});

describe('switch gates', () => {
    // a Switch at column 2 and a shut Gate of its flavor at column 4
    const run = (more = {}) => {
        world(10, floor(10), {
            switches: [[60, 7, 0, 2, 0, 1], ...(more.switches || [])],
            gates: [[61, 4, 0, 1, 0, 0, 7, 0], ...(more.gates || [])],
            rocks: more.rocks || [],
        });
        const walkGrid = walker(NONE, [], []);
        return xs(walkGrid, fill(walkGrid, 0, 1), 1);
    };
    test('a Switch only the hero stands on keeps its gates shut', () => {
        expect(run()).toEqual([0, 1, 2, 3]);
    });
    test("pushing a Rock onto every Switch of a flavor not pressed opens the flavor's shut gates", () => {
        expect(run({ rocks: [[64, 1, 0, 1]] })).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });
    test('a Switch of the flavor behind the gate keeps it shut', () => {
        expect(run({ switches: [[62, 7, 0, 6, 0, 1]] })).toEqual([0, 1, 2, 3]);
    });
    // an open notted Gate of the same flavor at column 7
    const notted = [[63, 7, 0, 1, 1, 1, 7, 0]];
    test('a flavor with notted gates and no object for its Switch stays as it is', () => {
        expect(run({ gates: notted })).toEqual([0, 1, 2, 3]);
    });
    test("a press opens a flavor's shut gates and shuts its notted ones together", () => {
        expect(run({ gates: notted, rocks: [[64, 1, 0, 1]] })).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
});

describe('skills', () => {
    test('a hero with PROTECTION pushes nothing', () => {
        world(8, floor(8), { rocks: [[9, 3, 0, 1]] });
        const walkGrid = walker(NONE, [], []);
        expect(xs(walkGrid, fill(walkGrid, 0, 1), 1)).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(xs(walkGrid, fill(walkGrid, 0, 1, 1), 1)).toEqual([0, 1, 2]);
    });
});

describe('water', () => {
    test('a jump marker does not let the hero into deep water: he lands at the surface - 1 and drowns', () => {
        world(8, { 7: [0, 1] }, { oceans: [[30, 0, 0, 4, 0, 2, 1]], jumps: [[3, 0, 0, 1]] }, { 4: [0], 5: [0] });
        const walkGrid = walker(NONE, [], []);
        expect(xs(walkGrid, fill(walkGrid, 0, 0), 0)).toEqual([0, 1, 2, 3]);
        expect(xs(walkGrid, fill(walkGrid, 0, 0), -1)).toEqual([]);
    });
});

describe('beam powers', () => {
    // a powered light at column 1 facing east, its beam over columns 2-6 (an Egg at 7 ends it); a wall at column 5
    const run = (color, more = {}) => {
        world(10, floor(10, { 5: [0, 1] }), {
            lights: [[50, 1, 0, 1, 0, 0, 0, 1, color]],
            beam_stops: [[7, 0, 1]],
            ...more,
        });
        const walkGrid = walker(NONE, [], []);
        return xs(walkGrid, fill(walkGrid, 0, 1), 1);
    };
    test('OPEN: the wall stops the walk', () => {
        expect(run(0)).toEqual([0, 1, 2, 3, 4]);
    });
    test('ENDPOINT: a move along the beam jumps to its last cell, against it to its first (from an end: no move)', () => {
        expect(run(5)).toEqual([0, 1, 2, 6]);
    });
    test('DOUBLE: a move in the beam goes two cells, checking the destination only', () => {
        expect(run(3)).toEqual([0, 1, 2, 4, 6, 7, 8]);
    });
    test('ALTER in the same cells leaves the move a plain step', () => {
        expect(
            run(5, {
                lights: [
                    [50, 1, 0, 1, 0, 0, 0, 1, 5],
                    [51, 1, 0, 1, 0, 0, 0, 1, 7],
                ],
            }),
        ).toEqual([0, 1, 2, 3, 4]);
    });
    test('SQUEEZE: a hero in the beam passes Fences', () => {
        world(10, floor(10), { fences: [[70, 3, 0, 1, 0]] });
        const plain = walker(NONE, [], []);
        expect(xs(plain, fill(plain, 0, 1), 1)).toEqual([0, 1, 2, 3]);
        world(10, floor(10), { fences: [[70, 3, 0, 1, 0]], lights: [[50, 1, 0, 1, 0, 0, 0, 1, 9]] });
        const walkGrid = walker(NONE, [], []);
        expect(xs(walkGrid, fill(walkGrid, 0, 1), 1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });
    // water at columns 3-6 (surface 0); a light at column 1, its beam over columns 2-7 (an Egg at 8 ends it)
    const sea = (color) => {
        world(
            10,
            { 9: [0, 1] },
            { oceans: [[30, 0, 0, 3, 0, 4, 1]], lights: [[50, 1, 0, 0, 0, 0, 0, 1, color]], beam_stops: [[8, 0, 0]] },
            { 3: [0], 4: [0], 5: [0], 6: [0] },
        );
        const walkGrid = walker(NONE, [], []);
        return xs(walkGrid, fill(walkGrid, 0, 0), 0);
    };
    test('DOUBLE over water holds the hero at the surface', () => {
        expect(sea(0)).toEqual([0, 1, 2]);
        expect(sea(3)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });
});

describe('pads to a Marker', () => {
    // a minor pad at column 1 whose target is a Marker above column 6; a wall at column 5
    const run = (to, water = {}, oceans = []) => {
        world(
            10,
            floor(10, { 5: [0, 1], ...Object.fromEntries(Object.keys(water).map((column) => [column, []])) }),
            { oceans },
            water,
        );
        PROG.teleporters = [{ pid: 80, p: [1, 0, 1], l: 0, major: 0, target: 81, en: 1, to }];
        const walkGrid = walker(NONE, [{ en: true, disc: true }], []);
        return xs(walkGrid, fill(walkGrid, 0, 1), 1);
    };
    test('the mover lands on the first supported cell at or below the Marker', () => {
        expect(run([6, 0, 7])).toEqual([0, 1, 2, 3, 4, 6, 7, 8]);
    });
    test('a Marker over deep water sends the mover nowhere', () => {
        world(10, floor(10, { 5: [0, 1], 6: [], 7: [] }), { oceans: [[30, 0, 0, 6, 0, 2, 1]] }, { 6: [0], 7: [0] });
        PROG.teleporters = [{ pid: 80, p: [1, 0, 1], l: 0, major: 0, target: 81, en: 1, to: [6, 0, 7] }];
        const walkGrid = walker(NONE, [{ en: true, disc: true }], []);
        const reached = fill(walkGrid, 0, 1);
        expect([0, -1, -2].flatMap((z) => xs(walkGrid, reached, z))).toEqual([]);
        expect(xs(walkGrid, reached, 1)).toEqual([0, 1, 2, 3, 4]);
    });
});
