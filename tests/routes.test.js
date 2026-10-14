// Routes on tiny synthetic overworlds: rock bridges in pocket floods, magic-mirror hops, the skip lane + TELEPORT
// swap, ALTER beams, OPEN beams opening Gates, requirement cycles, overlapping areas and mirror marks
import { describe, expect, test, vi } from 'vitest';
import { PROG, WORLD } from '../src/data.js';
import { endpointTarget } from '../src/walk/beams.js';
import { walker } from '../src/walk/walker.js';
import { levelAreaOf } from '../src/model/areas.js';
import { levelsNeedingLevel } from '../src/model/unlocking.js';

vi.mock('../src/data.js', async () => {
    const SCHEMA = (await import('../data/schema.json')).default;
    return { SCHEMA, PROG: {}, WORLD: {}, worldReady: Promise.resolve() };
});
vi.mock('../src/walk-data.js', () => ({ STATIC_ROLES: null, FLOOR_HEIGHTS: null, walkReady: Promise.resolve() }));

const Z_OFFSET = 64;
const [OPEN, DOUBLE, ALTER] = [0, 3, 7];
// A `width` x `height` grid. walls: per column (i + j * width) the solid z values; water: per column the indices into
// extra.oceans
function world({ width, height = 1, walls = {}, water = {}, extra = {} }) {
    const solidColumns = [],
        wet = [];
    for (let column = 0; column < width * height; column++) {
        const heights = walls[column] || [],
            oceanIndexes = water[column] || [];
        solidColumns.push(heights.length, ...heights.map((z) => z + Z_OFFSET));
        wet.push(oceanIndexes.length, ...oceanIndexes.flatMap((oceanIndex) => [oceanIndex & 255, oceanIndex >> 8]));
    }
    Object.assign(WORLD, {
        solid: Uint8Array.from(solidColumns),
        groups: new Uint8Array(0),
        water: Uint8Array.from(wet),
    });
    Object.assign(PROG, {
        levels: [],
        teleporters: [],
        freezers: [],
        world: {
            grid: { corner: [0, 0], size: [width, height], zoff: Z_OFFSET },
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
            magic_mirrors: [],
            skippable: [],
            teleport: [],
            area_pins: [],
            guy: [0, 0],
            ...extra,
        },
    });
}
const NONE = { get: () => undefined, ocean: [], created: new Map() };
// a BEAM_POWERED Gem_Slot at (0, 0, 0): it powers every light in that room
const POWERED_ROOM = [[90, 0, 0, 0, 1]];
// the reached cells at z as "i,j", sorted by row then column
const cells = (walkGrid, cellSet, z = 0) =>
    [...cellSet]
        .filter((cell) => Math.floor(cell / walkGrid.layerCells) - 80 === z)
        .map((cell) => [cell % walkGrid.width, Math.floor((cell % walkGrid.layerCells) / walkGrid.width)])
        .toSorted((first, second) => first[1] - second[1] || first[0] - second[0])
        .map((point) => point.join());
const columns = (walkGrid, cellSet, z = 0) => cells(walkGrid, cellSet, z).map((point) => +point.split(',')[0]);
const fill = (walkGrid, i, j, z, options) => walkGrid.flood([walkGrid.cellOf(i, j, z)], null, null, options);

describe('rock bridges in pocket floods', () => {
    // walls under every column at z 0 but the water column 5 (surface 1); a Rock at 3 is pushed from 2 into the water
    // at 5; column 9 is a high wall
    const setup = () => {
        const walls = {};
        for (let i = 0; i < 10; i++) if (i !== 5) walls[i] = [0];
        walls[9] = [0, 1, 2, 3];
        world({
            width: 10,
            walls,
            water: { 5: [0] },
            extra: {
                oceans: [[1, 1, 0, 5, 0, 1, 1]],
                rocks: [[9, 3, 0, 1]],
                bridges: [[9, 2, 0, 1, 5, 0, 1]],
            },
        });
        return walker(NONE, [], []);
    };
    test('a walk crosses only from the push side', () => {
        const walkGrid = setup();
        expect(columns(walkGrid, fill(walkGrid, 0, 0, 1), 1)).toContain(7);
        expect(columns(walkGrid, fill(walkGrid, 7, 0, 1), 1)).toEqual([6, 7, 8]);
    });
    test('a pocket flood counts the bridge water cell as floor from either side', () => {
        const walkGrid = setup();
        expect(columns(walkGrid, fill(walkGrid, 7, 0, 1, { pocket: true }), 1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });
});

describe('magic-mirror hops', () => {
    // an 8 x 8 grid, all wall at z 0 but the west arm (1..3, 4) and the south arm (4, 1..3) of a magic Mirror at (4, 4)
    // whose open arms face west and south
    const open = ['1,4', '2,4', '3,4', '4,1', '4,2', '4,3'];
    const setup = (extra = {}) => {
        const walls = {};
        for (let column = 0; column < 64; column++)
            if (!open.includes(`${column % 8},${Math.floor(column / 8)}`)) walls[column] = [0];
        world({ width: 8, height: 8, walls, extra: { magic_mirrors: [[5, 4, 4, 0, -1, 0, 0, -1, 0, 0]], ...extra } });
        return walker(NONE, [], []);
    };
    test('a hero on one arm lands as far down the other', () => {
        const walkGrid = setup();
        expect(cells(walkGrid, fill(walkGrid, 1, 4, 0))).toEqual(['4,1', '4,2', '4,3', '1,4', '2,4', '3,4']);
    });
    test('a second magic Mirror in the room stops every hop', () => {
        const walkGrid = setup({
            magic_mirrors: [
                [5, 4, 4, 0, -1, 0, 0, -1, 0, 0],
                [6, 7, 7, 0, 0, 0, 0, 0, 1, 0],
            ],
        });
        expect(cells(walkGrid, fill(walkGrid, 1, 4, 0))).toEqual(['1,4', '2,4', '3,4']);
    });
    test('the hero must stand nearer than the first target on the other arm', () => {
        // a Monster at (4, 1), the third cell of the south arm, which the wall at (4, 0) keeps from being pushed
        const walkGrid = setup({ monsters: [[7, 4, 1, 0, -2]] });
        expect(cells(walkGrid, fill(walkGrid, 1, 4, 0))).toEqual(['4,2', '4,3', '1,4', '2,4', '3,4']);
    });
    test('a Mirror in a closed Freezer makes no hops', () => {
        setup({ magic_mirrors: [[5, 4, 4, 0, -1, 0, 0, -1, 0, 30]] });
        PROG.freezers = [{ pid: 30, p: [4, 4, 0], req: [] }];
        const thawed = walker(NONE, [], [false]),
            frozen = walker(NONE, [], [true]);
        expect(cells(thawed, fill(thawed, 1, 4, 0))).toContain('4,2');
        expect(cells(frozen, fill(frozen, 1, 4, 0))).toEqual(['1,4', '2,4', '3,4']);
    });
});

describe('skip lane and TELEPORT swap', () => {
    // a row at z 0 on the implicit ground floor: the hero's side 10..2 (wrapping), a SKIPPABLE Rock at 2, water at 3..5
    // and 8..9 (surface 0), the island 6..7; a TELEPORT Wardrobe at 11 with its door on the west edge
    const setup = (teleport = [40]) => {
        const water = {};
        for (const i of [3, 4, 5, 8, 9]) water[i] = [0];
        world({
            width: 12,
            water,
            extra: {
                oceans: [[1, 0, 0, 0, 0, 12, 1]],
                rocks: [[9, 2, 0, 0]],
                skippable: [9],
                wardrobes: [[40, 11, 0, 0, 2, 2]],
                teleport,
            },
        });
        return walker(NONE, [], []);
    };
    test('push, launch, then TELEPORT: the hero swaps onto the landing cell', () => {
        const walkGrid = setup();
        expect(
            walkGrid.lanes.map((lane) => [lane.pushCell, lane.landing].map((cell) => cell % walkGrid.width)),
        ).toEqual([[1, 6]]);
        expect(columns(walkGrid, fill(walkGrid, 0, 0, 0))).toEqual([0, 1, 2, 6, 7, 10, 11]);
    });
    test('without a TELEPORT Wardrobe there is no swap', () => {
        const walkGrid = setup([]);
        expect(columns(walkGrid, fill(walkGrid, 0, 0, 0))).toEqual([0, 1, 2, 10, 11]);
    });
    test('a pocket flood walks the lane backwards to the push side', () => {
        const walkGrid = setup();
        expect(columns(walkGrid, fill(walkGrid, 7, 0, 0))).toEqual([6, 7]);
        expect(columns(walkGrid, fill(walkGrid, 7, 0, 0, { pocket: true }))).toEqual([0, 1, 2, 6, 7, 10, 11]);
    });
});

describe('ALTER beams', () => {
    test('ENDPOINT in ALTER jumps to the midpoint of the way to the end', () => {
        const beam = { cells: [10, 11, 12, 13, 14, 15, 16, 17, 18], index: 2, atInfinity: false };
        expect(endpointTarget(beam, true, false)).toBe(18);
        expect(endpointTarget(beam, false, false)).toBe(10);
        expect(endpointTarget(beam, true, true)).toBe(15);
        expect(endpointTarget(beam, false, true)).toBe(11);
    });
    // The walker's grid wraps in x and y and its ENDPOINT jumps follow horizontal beams only, so no walk reaches a beam
    // at infinity: the rule is tested on endpointTarget itself.
    test('ENDPOINT along a beam at infinity gives no landing, with or without ALTER', () => {
        const beam = { cells: [10, 11, 12, 13, 14, 15, 16, 17, 18], index: 2, atInfinity: true };
        expect(endpointTarget(beam, true, false)).toBe(-1);
        expect(endpointTarget(beam, true, true)).toBe(-1);
        expect(endpointTarget(beam, false, false)).toBe(10);
        expect(endpointTarget(beam, false, true)).toBe(11);
    });
    // a row of 11 at z 0: DOUBLE (and ALTER) lights at 0 facing east; column 10 a wall and a beam stop
    const setup = (lights) => {
        world({ width: 11, walls: { 10: [0] }, extra: { lights, beam_stops: [[10, 0, 0]], gem_slots: POWERED_ROOM } });
        return walker(NONE, [], []);
    };
    test('DOUBLE doubles each move, and triples it with ALTER', () => {
        const doubled = setup([[1, 0, 0, 0, 0, 0, 0, 0, DOUBLE]]);
        expect(columns(doubled, fill(doubled, 1, 0, 0))).toEqual([0, 1, 3, 5, 7, 9]);
        const tripled = setup([
            [1, 0, 0, 0, 0, 0, 0, 0, DOUBLE],
            [2, 0, 0, 0, 0, 0, 0, 0, ALTER],
        ]);
        expect(columns(tripled, fill(tripled, 1, 0, 0))).toEqual([0, 1, 3, 4, 6, 7, 9]);
    });
});

describe('OPEN beams and Gates', () => {
    // a row of 8 at z 0: a shut Gate at 3, column 7 a wall; lights at 0 facing east
    const setup = (lights, on = true) => {
        const gem_slots = on ? POWERED_ROOM : [];
        world({ width: 8, walls: { 7: [0] }, extra: { lights, gates: [[20, 3, 0, 0, 0, 0, 0, 0]], gem_slots } });
        return walker(NONE, [], []);
    };
    test('a hero in a powered OPEN beam opens the shut Gate ahead', () => {
        const walkGrid = setup([[1, 0, 0, 0, 0, 0, 0, 0, OPEN]]);
        expect(columns(walkGrid, fill(walkGrid, 1, 0, 0))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
    test('an unpowered OPEN light opens nothing', () => {
        const walkGrid = setup([[1, 0, 0, 0, 0, 0, 0, 0, OPEN]], false);
        expect(columns(walkGrid, fill(walkGrid, 1, 0, 0))).toEqual([0, 1, 2]);
    });
    test('an ALTER beam on the same cells keeps the Gate shut', () => {
        const walkGrid = setup([
            [1, 0, 0, 0, 0, 0, 0, 0, OPEN],
            [2, 0, 0, 0, 0, 0, 0, 0, ALTER],
        ]);
        expect(columns(walkGrid, fill(walkGrid, 1, 0, 0))).toEqual([0, 1, 2]);
    });
    test('a shut Gate no beam reaches stays shut', () => {
        const walkGrid = setup([]);
        expect(columns(walkGrid, fill(walkGrid, 1, 0, 0))).toEqual([0, 1, 2]);
    });
});

describe('levels whose requirements need a level', () => {
    // 0 the level asked about; 1 needs 0; 2 needs 1 (AND); 3 is OR of 0 and 4, 4 needs 1; 5 is OR of 0 and 6 (6 solved);
    // 7 needs 0 but is enabled from the start
    const levels = [
        { req: [] },
        { req: [0] },
        { req: [1] },
        { req: [0, 4], or: 1 },
        { req: [1] },
        { req: [0, 6], or: 1 },
        { req: [] },
        { req: [0], en: 1 },
    ];
    const unlocks = levels.map(() => ({ levels: [] }));
    levels.forEach((level, i) => level.req.forEach((j) => unlocks[j].levels.push(i)));
    const solved = (i) => i === 6;
    test('AND levels through any requirement, OR levels through every option', () => {
        expect([...levelsNeedingLevel(levels, unlocks, solved, 0)].toSorted()).toEqual([1, 2, 3, 4]);
    });
});

describe('areas named by activated pins', () => {
    test('the lowest float_parameter among the activated pins, else the level-data area', () => {
        PROG.areas = [{ pin: 100 }, { pin: 200 }, { pin: 300 }];
        const level = {
            area: 0,
            overlap: [
                [0, 2],
                [1, 200],
                [2, 200],
            ],
        };
        expect(levelAreaOf(level, new Set([100, 200, 300]))).toBe(0);
        expect(levelAreaOf(level, new Set([200, 300]))).toBe(1);
        expect(levelAreaOf(level, new Set([300]))).toBe(2);
        expect(levelAreaOf(level, new Set())).toBe(0);
        expect(levelAreaOf({ area: 2 }, new Set())).toBe(2);
    });
});

describe('mirror marks', () => {
    test('a destroyed Mirror leaves no mark', () => {
        world({ width: 8, extra: { mechs: [[2, 50, 4, 0, 0]] } });
        const near = (latest) => {
            const walkGrid = walker(latest, [], []);
            return walkGrid.mechAt(new Set([walkGrid.cellOf(4, 0, 0)]));
        };
        expect(near(NONE)).toBe(4);
        expect(near({ ...NONE, created: new Map([[50, { type: 'Mirror', destroyed: true }]]) })).toBe(0);
    });
});
