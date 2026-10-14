// A level frozen in a closed ice gate starts its pocket walk in the gate's cell, not on top of it
import { expect, test, vi } from 'vitest';
import { reachability } from '../src/walk/reachability.js';

// A row of 10 at z 0 on the implicit ground floor: the hero at 0..2; walls at z 0 in columns 3..6 (a ledge at z 1)
// and a high wall in column 9. Ice gate 0 holds level X in the wall cell (3, 0, 0); ice gate 1 sits in the air at
// (2, 0, 1), next to the ledge; level W stands in the pocket 7..8, which the ledge drops into.
vi.mock('../src/data.js', async () => {
    const SCHEMA = (await import('../data/schema.json')).default;
    const WIDTH = 10,
        Z_OFFSET = 64,
        columns = [];
    for (let i = 0; i < WIDTH; i++) {
        let heights = [];
        if (i >= 3 && i <= 6) heights = [0];
        if (i === 9) heights = [0, 1, 2, 3];
        columns.push(heights.length, ...heights.map((z) => z + Z_OFFSET));
    }
    const WORLD = { solid: Uint8Array.from(columns), groups: new Uint8Array(0), water: new Uint8Array(WIDTH) };
    const PROG = {
        levels: [
            { n: 'X', p: [3, 0, 0], req: [] },
            { n: 'W', p: [8, 0, 0], req: [] },
        ],
        teleporters: [],
        freezers: [
            { pid: 1, p: [3, 0, 0], req: [] },
            { pid: 2, p: [2, 0, 1], req: [] },
        ],
        map: { size: [WIDTH, 1], corner: [0, 0], layers: [{ key: 'ground', z: [-8, 8] }] },
        world: {
            grid: { corner: [0, 0], size: [WIDTH, 1], zoff: Z_OFFSET },
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
            lights: [],
            area_pins: [],
            guy: [0, 0],
        },
    };
    return { SCHEMA, PROG, WORLD, worldReady: Promise.resolve() };
});
vi.mock('../src/walk-data.js', () => ({ STATIC_ROLES: null, FLOOR_HEIGHTS: null, walkReady: Promise.resolve() }));

test('the frozen level seeds its pocket from the gate cell', () => {
    const history = { hero: [0, 0, 0], heroes: new Map(), heroAt: [], actions: [] },
        latest = { get: () => undefined, ocean: [], created: new Map() };
    const reach = reachability(history, latest, [], [true, true], [false, false]);
    // X belongs to its own gate; the ledge's gate 1 leads nowhere W's pocket reaches
    expect(reach.pocket.get(0)).toEqual([0]);
    expect(reach.pocket.get(1) ?? []).not.toContain(1);
    expect(reach.level).toEqual([false, false]);
});
