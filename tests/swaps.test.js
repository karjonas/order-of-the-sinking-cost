// Falls, TELEPORT swaps, lily rides, gates that hold the hero up and plan searches through cycles, on tiny synthetic
// overworlds
import { describe, expect, test, vi } from 'vitest';
import { PROG, WORLD } from '../src/data.js';
import { walker } from '../src/walk/walker.js';
import { unlockPlan } from '../src/model/plans.js';

vi.mock('../src/data.js', async () => {
    const SCHEMA = (await import('../data/schema.json')).default;
    return { SCHEMA, PROG: {}, WORLD: {}, worldReady: Promise.resolve() };
});
vi.mock('../src/walk-data.js', () => ({ STATIC_ROLES: null, FLOOR_HEIGHTS: null, walkReady: Promise.resolve() }));

const Z_OFFSET = 64;
// A `width` x `height` grid. walls: per column (i + j * width) the solid z values; water: per column the indices into
// extra.oceans; layers: [z, layer] pairs, each layer from its z up
function world({ width, height = 1, walls = {}, water = {}, layers = [], grid = {}, extra = {} }) {
    const solidColumns = [],
        wet = [];
    for (let column = 0; column < width * height; column++) {
        const heights = walls[column] || [],
            oceanIndexes = water[column] || [];
        solidColumns.push(heights.length, ...heights.map((z) => z + Z_OFFSET));
        wet.push(oceanIndexes.length, ...oceanIndexes.flatMap((oceanIndex) => [oceanIndex & 255, oceanIndex >> 8]));
    }
    const zlayer = Array.from({ length: 256 }, (_, zByte) => {
        let layer = 0;
        for (const [z, layerOfZ] of layers) if (zByte - Z_OFFSET >= z) layer = layerOfZ;
        return layer;
    });
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
            grid: { corner: [0, 0], size: [width, height], zoff: Z_OFFSET, ...grid },
            zlayer,
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
// the reached cells at z as "i,j", sorted by row then column
const cells = (walkGrid, cellSet, z = 0) =>
    [...cellSet]
        .filter((cell) => Math.floor(cell / walkGrid.layerCells) - 80 === z)
        .map((cell) => [cell % walkGrid.width, Math.floor((cell % walkGrid.layerCells) / walkGrid.width)])
        .toSorted((first, second) => first[1] - second[1] || first[0] - second[0])
        .map((point) => point.join());
const columns = (walkGrid, cellSet, z = 0) => cells(walkGrid, cellSet, z).map((point) => +point.split(',')[0]);
const lowest = (walkGrid, cellSet) =>
    Math.min(...[...cellSet].map((cell) => Math.floor(cell / walkGrid.layerCells) - 80));

describe('falls', () => {
    // a row of 3: column 0 a tower of wall up to z 19, the hero on top at z 20; columns 1 and 2 open down to the floor
    const tower = Array.from({ length: 20 }, (_, z) => z);
    test('a fall has no height limit', () => {
        world({ width: 3, walls: { 0: tower } });
        const walkGrid = walker(NONE, [], []);
        expect(columns(walkGrid, walkGrid.flood([walkGrid.cellOf(0, 0, 20)]), 0)).toEqual([1, 2]);
    });
    test('a pocket flood keeps the fall inside the layer it starts in', () => {
        world({ width: 3, walls: { 0: tower }, layers: [[10, 2]] });
        const walkGrid = walker(NONE, [], []);
        expect(columns(walkGrid, walkGrid.flood([walkGrid.cellOf(0, 0, 20)]), 0)).toEqual([1, 2]);
        expect(lowest(walkGrid, walkGrid.flood([walkGrid.cellOf(0, 0, 20)], null, null, { pocket: true }))).toBe(20);
    });
    test('a fall that starts in a map room does not drop out of it', () => {
        world({
            width: 3,
            walls: { 0: tower },
            layers: [[15, 3]],
            grid: { ft: { corner: [0, 0], size: [3, 1], z: 15 } },
        });
        const walkGrid = walker(NONE, [], []);
        expect(lowest(walkGrid, walkGrid.flood([walkGrid.cellOf(0, 0, 20)]))).toBe(20);
    });
});

describe('TELEPORT swaps', () => {
    // a row of 11 at z 0: the hero's side 0..2, water 3..6 and 10 (surface 0), an island 7..9 with a Rock at 7; by
    // default a wall at 10 ends the line west of the hero
    const setup = (extra = {}, walls = { 10: [0] }) => {
        const water = {};
        for (const i of [3, 4, 5, 6, 10]) water[i] = [0];
        world({
            width: 11,
            walls,
            water,
            extra: { oceans: [[1, 0, 0, 0, 0, 11, 1]], rocks: [[9, 7, 0, 0]], ...extra },
        });
        return walker(NONE, [], []);
    };
    const wizard = (walkGrid, i) => walkGrid.flood([[walkGrid.cellOf(i, 0, 0), 2]]);
    test('the line crosses water and the hero swaps onto the first target', () => {
        const walkGrid = setup();
        expect(columns(walkGrid, walkGrid.flood([walkGrid.cellOf(1, 0, 0)]))).toEqual([0, 1, 2]);
        expect(columns(walkGrid, wizard(walkGrid, 1))).toEqual([0, 1, 2, 7, 8, 9]);
    });
    test('a wall, a Mirror or a Wardrobe door edge ends the line', () => {
        const wall = setup({}, { 5: [0], 10: [0] });
        expect(columns(wall, wizard(wall, 1))).toEqual([0, 1, 2]);
        const mirror = setup({ movables: [[30, 5, 0, 0, 2]] });
        expect(columns(mirror, wizard(mirror, 1))).toEqual([0, 1, 2]);
        const door = setup({ wardrobes: [[40, 2, 0, 0, 0, 2]] });
        expect(columns(door, wizard(door, 1))).toEqual([0, 1, 2]);
    });
    test('the line wraps around the world', () => {
        // walls at 3 and 4 end the line east; west of 0 it wraps to 10 and runs on to the Rock at 7
        const walkGrid = setup({}, { 3: [0], 4: [0] });
        expect(columns(walkGrid, wizard(walkGrid, 1))).toEqual([0, 1, 2, 7, 8, 9]);
    });
    test('the skill comes from a TELEPORT Wardrobe left by its door', () => {
        // a Wardrobe at 0 with its door on the east edge: the hero enters it by the door and leaves it again
        const walkGrid = setup({ wardrobes: [[40, 0, 0, 0, 0, 2]], teleport: [40] });
        expect(columns(walkGrid, walkGrid.flood([walkGrid.cellOf(1, 0, 0)]))).toEqual([0, 1, 2, 7, 8, 9]);
        const plain = setup({ wardrobes: [[40, 0, 0, 0, 0, 2]] });
        expect(columns(plain, plain.flood([plain.cellOf(1, 0, 0)]))).toEqual([0, 1, 2]);
    });
});

describe('a stone riding a Lily', () => {
    // two rows of 14 at z 0. Row 0: the hero's side 0..2 with a SKIPPABLE Rock at 2, water 3..10 (surface 0) with a
    // Lily at 6 on a river flowing east over 6..9, dry land 11..13 with a TELEPORT Wardrobe at 13 (door west). Row 1:
    // wall but the dry cell (8, 1).
    const setup = (lilies, more = {}) => {
        const water = {},
            walls = {};
        for (let i = 3; i <= 10; i++) water[i] = [0];
        for (let i = 0; i < 14; i++) if (i !== 8) walls[14 + i] = [0];
        world({
            width: 14,
            height: 2,
            walls,
            water,
            extra: {
                oceans: [[1, 0, 0, 0, 0, 14, 1]],
                rocks: [[9, 2, 0, 0]],
                skippable: [9],
                lilies,
                rivers: [6, 7, 8, 9].map((i) => [i, 0, 0, 1]),
                wardrobes: [[40, 13, 0, 0, 2, 2]],
                teleport: [40],
                ...more,
            },
        });
        return walker(NONE, [], []);
    };
    const column = (walkGrid, cell) => cell % walkGrid.width;
    // per landing cell, the ride of a hero who swaps in at the landing and rides to the end
    const fullRides = (walkGrid) => {
        const rides = walkGrid.lanes
            .filter((lane) => lane.ride[0] === lane.landing)
            .map((lane) => lane.ride.map((cell) => column(walkGrid, cell)).join());
        return [...new Set(rides)].map((ride) => ride.split(',').map(Number));
    };
    test('the stone lands on the Lily anywhere along its drift, and it drifts on with the river until it is blocked', () => {
        const walkGrid = setup([[50, 6, 0, 0]]);
        expect(fullRides(walkGrid)).toEqual([[6, 7, 8, 9, 10], [7, 8, 9, 10], [8, 9, 10], [9, 10], [10], [11]]);
    });
    test('the Lily under the stone holds no hero, so a cell only it holds up is no line cell', () => {
        const walkGrid = setup([[50, 6, 0, 0]]);
        const onLily = walkGrid.lanes.filter((lane) => column(walkGrid, lane.landing) <= 10);
        const lineCells = new Set(onLily.flatMap((lane) => cells(walkGrid, lane.from)));
        expect([...lineCells].filter((cell) => ['6,0', '7,0', '8,0', '9,0', '10,0'].includes(cell))).toEqual([]);
        expect([...lineCells]).toEqual(expect.arrayContaining(['11,0', '8,1']));
        // a stone landing on dry land leaves the Lily free to hold the hero
        const onLand = walkGrid.lanes.filter((lane) => column(walkGrid, lane.landing) === 11);
        expect(onLand.flatMap((lane) => lane.from.map((cell) => column(walkGrid, cell)))).toContain(10);
    });
    test('a ride that reaches the cell the hero swapped from ends just before it', () => {
        // a shut Gate under the water at 10 holds the hero up there, on the Lily's way
        const walkGrid = setup([[50, 6, 0, 0]], { gates: [[20, 10, 0, -1, 0, 0, 0, 0]] });
        const fromTen = walkGrid.lanes.filter(
            (lane) => column(walkGrid, lane.landing) === 6 && lane.from.some((cell) => column(walkGrid, cell) === 10),
        );
        expect(fromTen.map((lane) => lane.ride.map((cell) => column(walkGrid, cell)))).toEqual([
            [6, 7, 8, 9],
            [7, 8, 9],
            [8, 9],
            [9],
        ]);
    });
    test('a hero who swaps onto it rides along and steps off', () => {
        const walkGrid = setup([[50, 6, 0, 0]]);
        expect(cells(walkGrid, walkGrid.flood([walkGrid.cellOf(0, 0, 0)]))).toContain('8,1');
        const noLily = setup([]);
        expect(cells(noLily, noLily.flood([noLily.cellOf(0, 0, 0)]))).not.toContain('8,1');
    });
});

describe('a hero boarding a drifting Lily', () => {
    // two rows of 10 at z 0. Row 0: water 0..7 (surface 0) on a river flowing east, dry land 8..9 (the island). Row 1:
    // the hero's shore at 3..4, wall elsewhere.
    const setup = (lilies) => {
        const water = {},
            walls = {};
        for (let i = 0; i <= 7; i++) water[i] = [0];
        for (let i = 0; i < 10; i++) if (i !== 3 && i !== 4) walls[10 + i] = [0];
        world({
            width: 10,
            height: 2,
            walls,
            water,
            extra: {
                oceans: [[1, 0, 0, 0, 0, 10, 2]],
                lilies,
                rivers: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i, 0, 0, 1]),
            },
        });
        const walkGrid = walker(NONE, [], []);
        return cells(walkGrid, walkGrid.flood([walkGrid.cellOf(3, 1, 0)]));
    };
    test('the hero boards the Lily where its drift passes the shore and rides it to the island', () => {
        expect(setup([[50, 0, 0, 0]])).toEqual(expect.arrayContaining(['8,0', '9,0']));
        expect(setup([])).toEqual(['3,1', '4,1']);
    });
    test('a Lily whose drift starts past the shore is out of reach', () => {
        expect(setup([[50, 5, 0, 0]])).toEqual(['3,1', '4,1']);
    });
    test('a Lily that does not exist drifts nowhere', () => {
        expect(setup([[50, 0, 0, 0, 0]])).toEqual(['3,1', '4,1']);
    });
});

describe('a Lily that does not exist', () => {
    // a row of 4 at z 0: dry 0 and 2, water at 1 (surface 0) with a Lily, a wall at 3
    const setup = (lily) => {
        world({
            width: 4,
            walls: { 3: [0] },
            water: { 1: [0] },
            extra: { oceans: [[1, 0, 0, 0, 0, 4, 1]], lilies: [lily] },
        });
        const walkGrid = walker(NONE, [], []);
        return columns(walkGrid, walkGrid.flood([walkGrid.cellOf(0, 0, 0)]));
    };
    test('is no floor', () => {
        expect(setup([50, 1, 0, 0])).toEqual([0, 1, 2]);
        expect(setup([50, 1, 0, 0, 1])).toEqual([0, 1, 2]);
        expect(setup([50, 1, 0, 0, 0])).toEqual([0]);
    });
});

describe('a stone landing on a drifting Lily', () => {
    // three rows of 10 at z 0. Row 1: the hero's side 0..2 with a SKIPPABLE Rock at 2, water 3..7 (surface 0), dry
    // land 8..9. Column 6 is a river flowing north through all three rows (wrapping round), with a Lily at (6, 0);
    // rows 0 and 2 are wall elsewhere.
    const setup = (lilies) => {
        const water = {},
            walls = {};
        for (let i = 3; i <= 7; i++) water[10 + i] = [0];
        for (const j of [0, 2]) {
            water[j * 10 + 6] = [0];
            for (let i = 0; i < 10; i++) if (i !== 6) walls[j * 10 + i] = [0];
        }
        world({
            width: 10,
            height: 3,
            walls,
            water,
            extra: {
                oceans: [[1, 0, 0, 0, 0, 10, 3]],
                rocks: [[9, 2, 1, 0]],
                skippable: [9],
                lilies,
                rivers: [0, 1, 2].map((j) => [6, j, 0, 2]),
            },
        });
        const walkGrid = walker(NONE, [], []);
        return [
            ...new Set(
                walkGrid.lanes.map(
                    (lane) => `${lane.landing % walkGrid.width},${Math.floor(lane.landing / walkGrid.width) % 3}`,
                ),
            ),
        ];
    };
    test('the stone lands where the Lily drifts across its way, not only at the cell the save left it in', () => {
        expect(setup([[50, 6, 0, 0]])).toEqual(['6,1', '8,1']);
        expect(setup([])).toEqual(['8,1']);
    });
});

describe('Gates that hold the hero up', () => {
    // a row of 7 at z 0: dry 0..2 and 4..5, water at 3 (surface 0) over a Gate at (3, 0, -1), a wall at 6
    const setup = (gate, switches = [], more = {}) => {
        world({
            width: 7,
            walls: { 6: [0] },
            water: { 3: [0] },
            extra: { oceans: [[1, 0, 0, 0, 0, 7, 1]], gates: [[20, 3, 0, -1, ...gate]], switches, ...more },
        });
        const walkGrid = walker(NONE, [], []);
        return columns(walkGrid, walkGrid.flood([walkGrid.cellOf(0, 0, 0)]));
    };
    test('a shut Gate under the water holds the hero at the surface; an open one does not', () => {
        expect(setup([0, 0, 0, 0])).toEqual([0, 1, 2, 3, 4, 5]);
        expect(setup([1, 0, 0, 0])).toEqual([0, 1, 2]);
    });
    test('a notted Gate stays open while its Switch is unpressed, even with the Switch in reach', () => {
        expect(setup([1, 1, 7, 0], [[60, 7, 0, 1, 0, 0]])).toEqual([0, 1, 2]);
    });
    test('a notted Gate whose Switch the save has pressed is shut and holds the hero up', () => {
        expect(setup([1, 1, 7, 0], [[60, 7, 1, 1, 0, 0]])).toEqual([0, 1, 2, 3, 4, 5]);
    });
    test('a notted Gate shuts and holds the hero up once the walk can push a Rock onto its Switch', () => {
        expect(setup([1, 1, 7, 0], [[60, 7, 0, 2, 0, 0]], { rocks: [[30, 1, 0, 0]] })).toEqual([0, 1, 2, 3, 4, 5]);
    });
});

describe('switch presses', () => {
    test('a notted Gate that a press shuts blocks its own cell', () => {
        // two rows of 10 at z 0. Row 0: the hero at 0, a Rock at 1, a flavor-7 Switch at 2, dry 3, a shut flavor-8 Gate
        // at 4, dry 5, an open notted flavor-7 Gate at 6, dry 7..8, a wall at 9. Row 1: dry 0, a Rock at 1, a flavor-8
        // Switch at 2, then wall. One pass presses both flavors, so the hero reaches the notted Gate after it shuts.
        const walls = {};
        for (let i = 3; i < 10; i++) walls[10 + i] = [0];
        walls[9] = [0];
        world({
            width: 10,
            height: 2,
            walls,
            extra: {
                rocks: [
                    [30, 1, 0, 0],
                    [31, 1, 1, 0],
                ],
                switches: [
                    [60, 7, 0, 2, 0, 0],
                    [62, 8, 0, 2, 1, 0],
                ],
                gates: [
                    [70, 4, 0, 0, 0, 0, 8, 0],
                    [71, 6, 0, 0, 1, 1, 7, 0],
                ],
            },
        });
        const walkGrid = walker(NONE, [], []);
        const row = cells(walkGrid, walkGrid.flood([walkGrid.cellOf(0, 0, 0)])).filter((cell) => cell.endsWith(',0'));
        expect(row).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0', '5,0']);
    });
    test('an object is pushed through a Gate a press has opened', () => {
        // three rows of 11 at z 0. Row 0: the hero at 0, a Rock at 1, a flavor-7 Switch at 2, a Rock at 3, a shut
        // flavor-7 Gate at 4, a flavor-8 Switch at 5, dry 6, a shut flavor-8 Gate at 7, dry 8..9, a wall at 10. Rows 1
        // and 2: dry 0..3, then wall, so the hero can push the second Rock aside and stand in its cell. Opening the
        // flavor-7 Gate lets that Rock be pushed through it onto the flavor-8 Switch.
        const walls = { 10: [0] };
        for (const j of [1, 2]) for (let i = 4; i < 11; i++) walls[j * 11 + i] = [0];
        world({
            width: 11,
            height: 3,
            walls,
            extra: {
                rocks: [
                    [30, 1, 0, 0],
                    [31, 3, 0, 0],
                ],
                switches: [
                    [60, 7, 0, 2, 0, 0],
                    [62, 8, 0, 5, 0, 0],
                ],
                gates: [
                    [70, 4, 0, 0, 0, 0, 7, 0],
                    [71, 7, 0, 0, 0, 0, 8, 0],
                ],
            },
        });
        const walkGrid = walker(NONE, [], []);
        const row = cells(walkGrid, walkGrid.flood([walkGrid.cellOf(0, 0, 0)])).filter((cell) => cell.endsWith(',0'));
        expect(row).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0', '5,0', '6,0', '7,0', '8,0', '9,0']);
    });
});

describe('a skipping stone onto a Switch', () => {
    // three rows of 10 at z 0. Row 0: the hero at 0, a Rock at 1, dry 2, water 3..5 (surface 0), an islet 6 with a
    // Switch, a shut Gate of its flavor at 7, dry 8, a wall at 9. Row 1: dry 0..6, the hero's way round to the Switch,
    // then wall. Row 2: wall.
    const setup = (skippable, more = {}, wet = [3, 4, 5]) => {
        const water = {},
            walls = { 9: [0] };
        for (const i of wet) water[i] = [0];
        for (let i = 7; i < 10; i++) walls[10 + i] = [0];
        for (let i = 0; i < 10; i++) walls[20 + i] = [0];
        world({
            width: 10,
            height: 3,
            walls,
            water,
            extra: {
                oceans: [[1, 0, 0, 0, 0, 10, 1]],
                rocks: [[9, 1, 0, 0]],
                skippable,
                switches: [[60, 7, 0, 6, 0, 0]],
                gates: [[61, 7, 0, 0, 0, 0, 7, 0]],
                ...more,
            },
        });
        const walkGrid = walker(NONE, [], []);
        return cells(walkGrid, walkGrid.flood([walkGrid.cellOf(0, 0, 0)])).filter((cell) => cell.endsWith(',0'));
    };
    test('a stone pushed into the water skips onto the Switch and opens its gates', () => {
        expect(setup([9])).toEqual(['0,0', '1,0', '2,0', '6,0', '7,0', '8,0']);
    });
    test('a plain Rock sinks, and the hero alone on the Switch keeps them shut', () => {
        expect(setup([])).toEqual(['0,0', '1,0', '2,0', '6,0']);
    });
    test('the stone stops on a Lily in its way, but skips on over a drifting one', () => {
        const lilies = [[50, 4, 0, 0]];
        expect(setup([9], { lilies })).toEqual(['0,0', '1,0', '2,0', '4,0', '6,0']);
        const rivers = [[4, 0, 0, 2]];
        expect(setup([9], { lilies, rivers })).toEqual(['0,0', '1,0', '2,0', '4,0', '6,0', '7,0', '8,0']);
    });
    test('a Lily that does not exist stops no stone', () => {
        expect(setup([9], { lilies: [[50, 4, 0, 0, 0]] })).toEqual(['0,0', '1,0', '2,0', '6,0', '7,0', '8,0']);
    });
    test('a stone pushed onto a drifting Lily is launched from it', () => {
        // dry 3, the Lily at 4 and water at 5 only
        const more = { lilies: [[50, 4, 0, 0]], rivers: [[4, 0, 0, 2]] };
        expect(setup([9], more, [4, 5])).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0', '6,0', '7,0', '8,0']);
    });
});

describe('unlock plans through cycles', () => {
    // level 0 playable; level 1 behind gate 0 (needs level 2) or gate 1 (needs level 0); level 2 behind gate 2 (needs
    // level 1): planning level 2 runs into itself through gate 0 and takes gate 1
    const setup = () => {
        Object.assign(PROG, {
            levels: [0, 1, 2].map((i) => ({ n: 'l' + i, req: [], p: [0, 0, 0] })),
            freezers: [[2], [0], [1]].map((req) => ({ req, signs: [] })),
            signs: [],
        });
        return {
            state: ['unlocked', 'blocked', 'blocked'],
            wayIn: [[], [0, 1], [2]],
            why: [null, { via: [], pad: [] }, { via: [], pad: [] }],
            behind: [[], [0, 1], [2]],
            gateOpen: [false, false, false],
            towers: [],
            signOk: () => true,
        };
    };
    test('a plan does not run through the key it is the plan of', () => {
        const progress = setup();
        expect([...unlockPlan(progress, ['level', 1]).nodes.keys()]).toEqual(['l0', 'g1', 'l1']);
        expect([...unlockPlan(progress, ['level', 2]).nodes.keys()]).toEqual(['l0', 'g1', 'l1', 'g2', 'l2']);
        expect([...unlockPlan(progress, ['gate', 0]).nodes.keys()]).toEqual(['l0', 'g1', 'l1', 'g2', 'l2', 'g0']);
    });
});
