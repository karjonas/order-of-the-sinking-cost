// Unlock plans worked out once for every requirement, the endgame chain in them, and the next steps
import { describe, expect, test, vi } from 'vitest';
import { PROG } from '../src/data.ts';
import { nextSteps, orderNextSteps } from '../src/model/next-steps.ts';
import { unlockPlan } from '../src/model/plans.ts';
import { gatesBehindThemselves } from '../src/model/way-in.ts';

vi.mock('../src/data.ts', async () => {
    const SCHEMA = (await import('../data/schema.json')).default;
    return { SCHEMA, PROG: {}, WORLD: {}, worldReady: Promise.resolve() };
});
vi.mock('../src/walk-data.ts', () => ({ STATIC_ROLES: null, FLOOR_HEIGHTS: null, walkReady: Promise.resolve() }));

const level = (name, extra = {}) => ({ n: name, req: [], p: [0, 0, 0], ...extra });
const keys = (P, root) => [...unlockPlan(P, root).nodes.keys()];
// a progress state: `state` per level, way-in gates per blocked level, every gate closed
function progress({ state, wayIn = [], towers = [], rank = 0, extra = {} }) {
    const P = {
        state,
        wayIn: state.map((levelState, i) => (levelState === 'blocked' ? wayIn[i] || [] : null)),
        why: state.map((levelState) => (levelState === 'blocked' ? { via: [], pad: [] } : null)),
        behind: state.map((_, i) => wayIn[i] || []),
        gateOpen: PROG.freezers.map(() => false),
        towers,
        tst: (PROG.teleporters || []).map(() => ({ en: true, disc: false })),
        goldFound: 0,
        signOk: (sign) => {
            if (sign.rank) return sign.rank <= rank;
            if (sign.tower != null) return !!towers[sign.tower]?.active;
            return false;
        },
        ...extra,
    };
    return P;
}

describe('plans do not depend on the root', () => {
    // level 0 playable; levels 1 and 2 each behind gate 1 (needs 0) or gate 2 (needs 3, which needs 0 too)
    test("a requirement's plan is the same inside any other plan", () => {
        Object.assign(PROG, {
            levels: [level('a'), level('b'), level('c'), level('d', { req: [0] })],
            freezers: [
                { req: [2], signs: [] },
                { req: [0], signs: [] },
                { req: [3], signs: [] },
            ],
            signs: [],
            gold_rooms: [],
        });
        const P = progress({ state: ['unlocked', 'blocked', 'blocked', 'locked'], wayIn: [[], [0, 1], [2]] });
        expect(keys(P, ['level', 1])).toEqual(['l0', 'g1', 'l1']);
        expect(keys(P, ['level', 2])).toEqual(['l0', 'l3', 'g2', 'l2']);
        // gate 0 needs level 2, whose plan is the same here as on its own
        expect(keys(P, ['gate', 0])).toEqual(['l0', 'l3', 'g2', 'l2', 'g0']);
        const plan = unlockPlan(P, ['gate', 0]);
        expect(plan.edges).toEqual([
            ['l0', 'l3'],
            ['l3', 'g2'],
            ['g2', 'l2'],
            ['l2', 'g0'],
        ]);
    });
    test('an OR takes its cheapest option; a cycle with no way out has no plan', () => {
        Object.assign(PROG, {
            levels: [
                level('a'),
                level('b', { req: [2, 0], or: 1 }),
                level('c', { req: [3] }),
                level('d', { req: [2] }),
            ],
            freezers: [],
            signs: [],
            gold_rooms: [],
        });
        const P = progress({ state: ['unlocked', 'locked', 'locked', 'locked'] });
        expect(keys(P, ['level', 1])).toEqual(['l0', 'l1']);
        expect(unlockPlan(P, ['level', 1]).nodes.get('l1').alt).toBe(2);
        expect(unlockPlan(P, ['level', 2])).toBe(null);
    });
});

describe('a gate that needs what sits behind it is no way in', () => {
    // gate 0 needs level 0, which sits behind gate 1; gate 1 needs level 1, which sits behind gate 0. Level 2 sits
    // behind gate 0 or gate 2, which needs the playable level 3.
    test('a two-gate cycle drops out of the way in; its levels become steps of their own', () => {
        Object.assign(PROG, {
            levels: [level('zach1'), level('airmail'), level('beyond'), level('open')],
            freezers: [
                { req: [0], signs: [] },
                { req: [1], signs: [] },
                { req: [3], signs: [] },
            ],
            signs: [],
            gold_rooms: [],
        });
        const state = ['blocked', 'blocked', 'blocked', 'unlocked'];
        const wayIn = [[1], [0], [0, 2], null];
        const behind = gatesBehindThemselves({
            state,
            wayIn,
            via: () => [],
            ice: state.map(() => undefined),
            gateOpen: [false, false, false],
            met: () => false,
        });
        expect([...behind].toSorted()).toEqual([0, 1]);
        const kept = wayIn.map((gates) => gates && gates.filter((fi) => !behind.has(fi)));
        const P = progress({ state, wayIn: kept });
        expect(keys(P, ['level', 2])).toEqual(['l3', 'g2', 'l2']);
        expect(keys(P, ['level', 0])).toEqual(['l0']);
        expect(keys(P, ['level', 1])).toEqual(['l1']);
    });
    test('a cycle with a way out keeps its gates', () => {
        Object.assign(PROG, {
            levels: [level('zach1'), level('airmail'), level('open')],
            freezers: [
                { req: [0], signs: [] },
                { req: [1], signs: [] },
            ],
            signs: [],
            gold_rooms: [],
        });
        // level 1 is also reached by a pad from the playable level 2
        const state = ['blocked', 'blocked', 'unlocked'];
        const behind = gatesBehindThemselves({
            state,
            wayIn: [[1], [0], null],
            via: (i) => (i === 1 ? [2] : []),
            ice: state.map(() => undefined),
            gateOpen: [false, false],
            met: () => false,
        });
        expect(behind.size).toBe(0);
    });
});

describe('towers and the endgame chain', () => {
    // two ground towers of 3 levels needing 2 each, one gold room per tower; end1 behind gate 0 on the gold Sign
    // (both rooms); the rank 1 Door gate 1 holds level 7
    const setup = (state, extra = {}) => {
        Object.assign(PROG, {
            levels: [
                level('t0a', { t: 1 }),
                level('t0b', { t: 1 }),
                level('t0c', { t: 1, req: [0] }),
                level('t1a', { t: 2 }),
                level('t1b', { t: 2 }),
                level('t1c', { t: 2 }),
                level('end1', { a: 'ENDGAME1' }),
                level('after', {}),
            ],
            freezers: [
                { req: [], signs: [{ pid: 90, gold: 2 }] },
                { req: [], signs: [{ pid: 91, rank: 1 }] },
            ],
            signs: [
                { pid: 90, gold: 2, gates: [0], p: [0, 0, 0] },
                { pid: 91, rank: 1, gates: [1], p: [0, 0, 0] },
            ],
            teleporters: [{ pid: 1 }, { pid: 2 }, { pid: 3 }, { pid: 4 }],
            gold_rooms: [
                { tower: 0, pad: 0, endpoint: 1 },
                { tower: 1, pad: 2, endpoint: 3 },
            ],
        });
        const towers = [
            { t: 1, req: 2, normal: [0, 1, 2], solvedNormal: 0, active: false },
            { t: 2, req: 2, normal: [3, 4, 5], solvedNormal: 0, active: false },
        ];
        const wayIn = state.map(() => []);
        wayIn[6] = [0];
        wayIn[7] = [1];
        return progress({ state, wayIn, towers, ...extra });
    };
    const open = ['unlocked', 'unlocked', 'locked', 'unlocked', 'unlocked', 'unlocked', 'blocked', 'blocked'];
    test('a tower needs its cheapest levels, as many as it still needs', () => {
        expect(keys(setup(open), ['tower', 0])).toEqual(['l0', 'l1', 't0']);
    });
    test('a level reached through a Tower pad needs that Tower', () => {
        const P = setup(open);
        P.wayIn[7] = [];
        P.why[7] = { via: [], pad: [], viaTowers: [0] };
        expect(keys(P, ['level', 7])).toEqual(['l0', 'l1', 't0', 'l7']);
    });
    test('the gold Sign needs that many gold rooms, each its tower and a step onto its pad', () => {
        const plan = keys(setup(open), ['level', 6]);
        for (const key of ['t0', 'p0', 't1', 'p1', 'g0', 'l6']) expect(plan).toContain(key);
        // the sign rule step (keyed by gate and place here, as the sign table is read when the module loads)
        expect(plan.slice(-3)).toEqual(['x0:0', 'g0', 'l6']);
    });
    test('a rank Sign needs the ENDGAME level that gives the rank', () => {
        const plan = keys(setup(open), ['level', 7]);
        expect(plan).toContain('l6');
        expect(plan.slice(-3)).toEqual(['x1:0', 'g1', 'l7']);
    });
    test('an ending is no step of its own', () => {
        const P = setup(open);
        expect(unlockPlan(P, ['level', 6]).steps).toBeGreaterThan(1);
        expect(unlockPlan(P, ['level', 6]).nodes.get('l6').front).toBeUndefined();
    });
    test('a level on a layer the walk does not reach needs the way onto it, and the sky comes after rank 1', () => {
        const access = open.map(() => null);
        access[7] = 'sky';
        const P = setup(open, { extra: { access } });
        P.wayIn[7] = [];
        const plan = keys(P, ['level', 7]);
        expect(plan.slice(-2)).toEqual(['a:sky', 'l7']);
        expect(plan).toContain('l6');
    });
    test('next steps lead with the steps toward the next ending', () => {
        const P = setup(open);
        P.plans = undefined;
        const status = { achievements: 0n };
        P.needed = nextSteps(P, status);
        expect(P.needed[0].ending).toBe(0);
        expect(P.needed[0].towers).toEqual([[0, 2]]);
        // level 7, not reachable, is a step of its own plan only: no tower, no ending, nothing after it
        expect(P.needed[7]).toEqual({ towers: [], down: new Set() });
        const shown = { level: () => true, gate: () => true, tower: () => true, dist: () => 0 };
        const ids = P.needed.map((needed, i) => (needed ? i : -1)).filter((i) => i >= 0);
        expect(orderNextSteps(P, ids, shown).slice(0, 2)).toEqual([0, 1]);
    });
});
