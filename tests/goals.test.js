// The goals ladder: its order and active goal, roles relative to a goal, what a level leads to, and spoiler-safe labels
import { describe, expect, test, vi } from 'vitest';
import { PROG, SCHEMA } from '../src/data.js';
import { roleFor } from '../src/model/goal-roles.js';
import { activeGoal, goalLadder } from '../src/model/goals.js';
import { goalsView } from '../src/model/goals-view.js';
import { planAll } from '../src/model/plans.js';

// the sign table is read when requirements.js loads, so the gold Sign is in it from the start
vi.mock('../src/data.js', async () => {
    const schema = (await import('../data/schema.json')).default;
    const data = { signs: [{ pid: 90, gold: 2, gates: [0, 1], p: [0, 0, 0] }] };
    return { SCHEMA: schema, PROG: data, WORLD: {}, worldReady: Promise.resolve() };
});
vi.mock('../src/walk-data.js', () => ({ STATIC_ROLES: null, FLOOR_HEIGHTS: null, walkReady: Promise.resolve() }));
// the page, without its DOM
vi.mock('../src/view.js', () => ({ show() {} }));
// the test levels have no map layers: everything stands on the ground
vi.mock('../src/model/layers.js', async (importOriginal) => ({
    ...(await importOriginal()),
    layerName: (key) => key,
    mapLayerOf: () => 'ground',
}));

const level = (name, extra = {}) => ({ n: name, req: [], p: [0, 0, 0], ...extra });
const achievementBit = (name) =>
    1n << BigInt(SCHEMA.enums.Achievement.values.find(([valueName]) => valueName === name)[1]);

// Three ground towers (HxM, HxS, MxS) of two levels needing one each, a gold room each. end1 sits behind ice gates 0
// and 1, both on the gold Sign (2 rooms). t0b is locked behind `key`; t2a is not reachable, behind gate 2 (needs
// `left`) or gate 3 (needs `right`).
function setup({ rooms = 3, achievements = 0n } = {}) {
    Object.assign(PROG, {
        levels: [
            level('t0a', { t: 3 }),
            level('t0b', { t: 3, req: [7] }),
            level('t1a', { t: 5 }),
            level('t1b', { t: 5 }),
            level('t2a', { t: 6 }),
            level('t2b', { t: 6, req: [7] }),
            level('end1', { a: 'ENDGAME1' }),
            level('key'),
            level('left'),
            level('right'),
        ],
        freezers: [
            { req: [], signs: [{ pid: 90, gold: 2 }] },
            { req: [], signs: [{ pid: 90, gold: 2 }] },
            { req: [8], signs: [] },
            { req: [9], signs: [] },
        ],
        teleporters: [{ pid: 1 }, { pid: 2 }, { pid: 3 }, { pid: 4 }, { pid: 5 }, { pid: 6 }],
        gold_rooms: [
            { tower: 0, pad: 0, endpoint: 1 },
            { tower: 1, pad: 2, endpoint: 3 },
            { tower: 2, pad: 4, endpoint: 5 },
        ].slice(0, rooms),
    });
    const state = ['unlocked', 'locked', 'unlocked', 'unlocked', 'blocked', 'locked', 'blocked', 'unlocked'];
    state.push('unlocked', 'unlocked');
    const wayIn = state.map((levelState) => (levelState === 'blocked' ? [] : null));
    wayIn[6] = [0, 1];
    wayIn[4] = [2, 3];
    const towers = [3, 5, 6].map((towerId, ti) => ({
        t: towerId,
        req: 1,
        normal: [2 * ti, 2 * ti + 1],
        drop: [],
        solvedNormal: 0,
        active: false,
        p: [0, 0, 0],
    }));
    const progress = {
        state,
        wayIn,
        why: state.map((levelState) => (levelState === 'blocked' ? { via: [], pad: [] } : null)),
        behind: wayIn.map((gates) => gates || []),
        gateOpen: PROG.freezers.map(() => false),
        towers,
        tst: PROG.teleporters.map(() => ({ en: true, disc: false })),
        goldFound: 0,
        signOk: () => false,
        solved: 0,
        hidden: state.map(() => false),
        towerHidden: towers.map(() => false),
        needed: state.map(() => null),
    };
    const status = { achievements };
    progress.plans = planAll(progress);
    progress.goals = goalLadder(progress, status);
    return { progress, status };
}
// the model's goals over a progress state; endings[i] says whether ending i is earned and shown
function view({ progress, status }, { endings = [], towerHidden = [] } = {}) {
    towerHidden.forEach((hidden, ti) => (progress.towerHidden[ti] = hidden));
    return goalsView({
        status,
        progress,
        levels: PROG.levels,
        endings: ['ENDGAME1', 'ENDGAME2', 'ENDGAME3'].map((name, i) => ({
            name,
            earned: !!endings[i]?.earned,
            shown: endings[i]?.shown ?? true,
        })),
        achievementHidden: () => false,
        achievementRule: () => null,
        gateShown: () => true,
        gateArea: () => 'Heroes and Light',
        stepShown: (node) => node.t !== 't' || !progress.towerHidden[node.id],
        heroDist: () => 0,
    });
}
const nodeNeed = (progress, goal, key) => goal.roles.need[progress.plans.G.index.get(key)];

describe('the goals ladder', () => {
    test('endings, towers, achievements, Completionist; the first one not done is active', () => {
        const { progress } = setup();
        expect(progress.goals.map((goal) => goal.key)).toEqual([
            'ending:ENDGAME1',
            'ending:ENDGAME2',
            'ending:ENDGAME3',
            'towers',
            'achievements',
            'completionist',
        ]);
        expect(activeGoal(progress.goals).key).toBe('ending:ENDGAME1');
        expect(progress.goals[3].children.map((child) => child.key)).toEqual(['tower:0', 'tower:1', 'tower:2']);
        expect(progress.goals[4].children.some((child) => child.name === 'COMPLETIONIST')).toBe(false);
        const later = setup({ achievements: achievementBit('ENDGAME1') });
        expect(later.progress.goals[0].done).toBe(true);
        expect(activeGoal(later.progress.goals).key).toBe('ending:ENDGAME2');
    });
});

describe('roles relative to a goal', () => {
    test('an ending needs the gold Sign on every route, its gates and the towers one of several', () => {
        const { progress } = setup();
        const ending = progress.goals[0];
        expect(roleFor(ending, 'l', 6)).toBe('req');
        expect(roleFor(ending, 'g', 0)).toBe('one');
        expect(roleFor(ending, 'g', 1)).toBe('one');
        // the Sign both gates ask for
        expect(nodeNeed(progress, ending, 's0')).toBe(2);
        // 2 of the 3 gold rooms, each its tower
        for (const key of ['p0', 'p1', 'p2', 't0', 't1', 't2']) expect(nodeNeed(progress, ending, key)).toBe(1);
        expect(roleFor(ending, 'l', 0)).toBe('one');
        expect(roleFor(ending, 'l', 7)).toBe('one');
        // a goal asks for nothing outside its routes
        expect(roleFor(progress.goals[3].children[1], 'l', 0)).toBe('optional');
    });
    test('with as many gold rooms left as the Sign needs, every tower is on every route', () => {
        const { progress } = setup({ rooms: 2 });
        const ending = progress.goals[0];
        expect(nodeNeed(progress, ending, 't0')).toBe(2);
        expect(nodeNeed(progress, ending, 't1')).toBe(2);
        // a tower still needs only one of its levels
        expect(roleFor(ending, 'l', 2)).toBe('one');
        expect(roleFor(ending, 'l', 4)).toBe('optional');
    });
});

describe('what a level leads to', () => {
    test('the tower and the levels it has left, the level it unlocks, the ice gate it opens', () => {
        const model = view(setup());
        const ending = model.goals[0];
        const leads = new Map(model.goalLevels(ending).map((entry) => [PROG.levels[entry.i].n, entry]));
        expect(leads.get('t0a').leadsTo).toBe('HxM tower · 1 to go');
        expect(leads.get('key').leadsTo).toBe('unlocks t0b');
        expect(leads.get('left').leadsTo).toBe('opens ice gate Heroes and Light · one of 2 routes');
        expect(leads.get('end1').leadsTo).toBe('Endgame');
        // playable first, then not reachable, then locked
        const groups = model.goalLevels(ending).map((entry) => entry.group);
        expect(groups).toEqual(
            groups.toSorted(
                (first, second) =>
                    ['playable', 'blocked', 'locked'].indexOf(first) -
                    ['playable', 'blocked', 'locked'].indexOf(second),
            ),
        );
    });
    test('a tower under fog is not named; its goal is left out of the towers', () => {
        const model = view(setup(), { towerHidden: [true, false, false] });
        const leads = new Map(model.goalLevels(model.goals[0]).map((entry) => [PROG.levels[entry.i].n, entry.leadsTo]));
        expect(leads.get('t0a')).not.toContain('HxM');
        expect(model.goals[3].children.map((child) => child.label)).toEqual(['HxS tower', 'MxS tower']);
        expect(model.goals[3].fogged).toBe(true);
    });
});

describe('spoiler labels', () => {
    test('an ending not shown is left out of the ladder; the ones shown carry their Steam names', () => {
        const endingLabels = (model) => model.goals.filter((goal) => goal.kind === 'ending').map((goal) => goal.label);
        const first = view(setup(), { endings: [{}, { shown: false }, { shown: false }] });
        expect(endingLabels(first)).toEqual(['Endgame']);
        expect(first.goals[1].key).toBe('towers');
        const firstEarned = view(setup({ achievements: achievementBit('ENDGAME1') }), {
            endings: [{ earned: true }, {}, { shown: false }],
        });
        expect(endingLabels(firstEarned)).toEqual(['Endgame', 'Second Endgame']);
    });
});
