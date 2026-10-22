// The second ending as an ordered list of stages: the sky crossroads, the sky towers, the hub, the end2 room's level,
// the ending's level
import { describe, expect, test, vi } from 'vitest';
import { PROG, SCHEMA } from '../src/data.ts';
import { goalLadder } from '../src/model/goals.ts';
import { goalsView } from '../src/model/goals-view.ts';
import type { GoalsView } from '../src/model/goals-view.ts';
import type { NextStep } from '../src/model/next-steps.ts';
import { planAll } from '../src/model/plans.ts';
import type { BaseProgress, ShownProgress } from '../src/model/progress.ts';
import type { TowerProgress } from '../src/model/towers.ts';
import type { LevelState, SignRule } from '../src/model/unlocking.ts';
import { level } from './fixtures.ts';

// the sign table is read when requirements loads, so the two hub Signs are in it from the start
vi.mock('../src/data.ts', async () => {
    const schema = (await import('../data/schema.json')).default;
    const data = {
        signs: [
            { pid: 90, tower: 0, gates: [0], p: [0, 0, 0] },
            { pid: 91, tower: 1, gates: [1], p: [0, 0, 0] },
        ],
    };
    return { SCHEMA: schema, PROG: data, WORLD: {}, worldReady: Promise.resolve() };
});
vi.mock('../src/walk-data.ts', () => ({ STATIC_ROLES: null, FLOOR_HEIGHTS: null, walkReady: Promise.resolve() }));
vi.mock('../src/view.ts', () => ({ show() {}, async showSave() {} }));
vi.mock('../src/model/layers.ts', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/model/layers.ts')>()),
    layerName: (key: string) => key,
    mapLayerOf: () => 'ground',
}));

const ascend = 1n << BigInt(SCHEMA.enums.Achievement.values.find(([name]) => name === 'ASCEND')![1]);

interface SetupOptions {
    ascended?: boolean;
    /** Per sky tower, whether it is active. */
    active?: boolean[];
    /** Per sky tower, whether its hub Freezer is open. */
    open?: boolean[];
    solved?: number[];
}

// Two sky towers of one level each (levels 0 and 1) with a hub Freezer each, the end2 room's level `laser_pointer`
// (2) and the ENDGAME2 level (3)
function setup({ ascended = false, active = [false, false], open = [false, false], solved = [] }: SetupOptions = {}) {
    Object.assign(PROG, {
        levels: [
            level('t0a', { t: 17 }),
            level('t1a', { t: 18 }),
            level('laser_pointer'),
            level('all_together_now', { a: 'ENDGAME2' }),
        ],
        freezers: [
            { req: [], signs: [{ pid: 90, tower: 0 }] },
            { req: [], signs: [{ pid: 91, tower: 1 }] },
        ],
        areas: [
            { local_area_name: 'area_s_upper_crossroads', display: 'Crossroads High', pin: 1 },
            { local_area_name: 'area_s_antipode_high', display: 'Antipode High', pin: 2 },
        ],
        teleporters: [],
        gold_rooms: [],
        known_routes: [],
    });
    const state: LevelState[] = ['unlocked', 'unlocked', 'unlocked', 'unlocked'];
    const towers = [17, 18].map((bits, towerIndex): TowerProgress => {
        if (active[towerIndex]) state[towerIndex] = 'solved';
        return {
            pid: 0,
            t: bits,
            req: 1,
            p: [0, 0, 0],
            normal: [towerIndex],
            drop: [],
            solvedNormal: Number(active[towerIndex]),
            active: active[towerIndex],
            gold: false,
        };
    });
    for (const levelIndex of solved) state[levelIndex] = 'solved';

    const signOk = (sign: SignRule) => sign.tower != null && towers[sign.tower].active;
    const base: BaseProgress & { hidden: boolean[]; towerHidden: boolean[] } = {
        state,
        unlocks: state.map(() => ({ levels: [] })),
        wayIn: state.map(() => null),
        wayInChains: state.map(() => null),
        wayInFixed: new Set(),
        why: state.map(() => null),
        behind: state.map(() => []),
        access: state.map(() => null),
        signAccess: [],
        signWayIn: [],
        ice: [],
        reach: null,
        lt: null,
        gateOpen: open,
        towers,
        tst: [],
        goldFound: 0,
        signOk,
        signRead: () => false,
        solved: 0,
        hidden: state.map(() => false),
        towerHidden: towers.map(() => false),
    };
    const status = { achievements: ascended ? ascend : 0n };
    const progress: ShownProgress = {
        ...base,
        plans: planAll(base),
        needed: state.map((): NextStep | null => null),
        goals: [],
    };
    progress.goals = goalLadder(progress, status);
    return { progress, status };
}

interface ViewOptions {
    areaShown?: boolean;
    hiddenLevels?: number[];
}

function view(
    { progress, status }: ReturnType<typeof setup>,
    { areaShown = true, hiddenLevels = [] }: ViewOptions = {},
): GoalsView {
    for (const levelIndex of hiddenLevels) progress.hidden[levelIndex] = true;
    return goalsView({
        status,
        progress,
        levels: PROG.levels,
        endings: ['ENDGAME1', 'ENDGAME2', 'ENDGAME3'].map((name) => ({ name, earned: false, shown: true })),
        achievementHidden: () => false,
        achievementRule: () => undefined,
        areaShown: () => areaShown,
        gateShown: () => true,
        gatePlace: () => '',
        signShown: () => true,
        stepShown: () => true,
        heroDist: () => 0,
    });
}

const high = (goals: GoalsView) => goals.goals.find((goal) => goal.key === 'ending:ENDGAME2')!;
const labels = (goals: GoalsView) => high(goals).children!.map((child) => child.label);
const dones = (goals: GoalsView) => high(goals).children!.map((child) => child.done);
const activeLabels = (goals: GoalsView) =>
    high(goals)
        .children!.filter((child) => child.active)
        .map((child) => child.label);

describe('the second ending as stages', () => {
    test('the children are the stages in order, each with its own done mark', () => {
        const goals = view(setup({ ascended: true, active: [true, false], open: [true, false] }));
        expect(labels(goals)).toEqual([
            'Crossroads High',
            'High Heroes',
            'High Mirrors',
            'Antipode High',
            'laser_pointer',
            'all_together_now',
        ]);
        expect(dones(goals)).toEqual([true, true, false, false, false, false]);
        expect(activeLabels(goals)).toEqual(['High Mirrors']);
    });

    test('a tower activated whose hub Freezer is closed is not done', () => {
        const goals = view(setup({ ascended: true, active: [true, true], open: [true, false] }));
        expect(dones(goals)).toEqual([true, true, false, false, false, false]);
        expect(activeLabels(goals)).toEqual(['High Mirrors']);
    });

    test('the hub is done when every hub Freezer is open, the room and the ending when solved', () => {
        const goals = view(setup({ ascended: true, active: [true, true], open: [true, true], solved: [2] }));
        expect(dones(goals)).toEqual([true, true, true, true, true, false]);
        expect(activeLabels(goals)).toEqual(['all_together_now']);
    });

    test('before the sky is reached the crossroads is the active stage', () => {
        const goals = view(setup());
        expect(activeLabels(goals)).toEqual(['Crossroads High']);
    });

    test('a tower asks for its hub Freezer', () => {
        const { progress } = setup({ active: [true, false] });
        const ending = progress.goals[1];
        if (ending.kind !== 'ending') throw new Error('not an ending');

        const towerStages = ending.children!.filter((child) => child.kind === 'tower');
        const keys = towerStages.map((child) => progress.plans.G.keys[child.targets[0]]);
        expect(keys).toEqual(['g0', 'g1']);
    });

    test('a place is named once its area shows and a level once it is not under fog', () => {
        const goals = view(setup({ ascended: true }), { areaShown: false, hiddenLevels: [2] });
        expect(labels(goals)).toEqual(['High Heroes', 'High Mirrors', 'all_together_now']);
        expect(high(goals).fogged).toBe(true);
    });
});
