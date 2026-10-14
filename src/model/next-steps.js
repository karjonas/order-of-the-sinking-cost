// Next steps: the levels playable now that open what is still to do, and the order of a goal's list
// (VIEWER.md "Next steps")
import { PROG } from '../data.js';
import { ENDINGS, hasAchievement } from './achievements.js';
import { roleFor } from './goal-roles.js';
import { roleOf } from './level-roles.js';
import { planAll } from './plans.js';

// Next steps: the levels playable now that open the unlock plan of anything still to do (a tower not activated, an
// achievement level, a locked or unreachable level, a closed ice gate), and the levels the walk calls unreachable that
// such a plan runs through. Per level: the towers its plans bring closer (with the levels each has left; a tower counts
// every unsolved level of its own with a plan) and the level and gate keys after it in those plans. Plans do not depend
// on the goal, so a key comes after a level in a goal's plan when the level is in the key's plan; the roles that pick
// the keys a goal needs are applied where the list is ordered or labelled.
export function nextSteps(progress, status) {
    const levels = PROG.levels,
        out = levels.map(() => null),
        plans = progress.plans || planAll(progress),
        { G: graph, steps, settled } = plans;
    const has = (key) => {
        const id = graph.index.get(key);
        return id !== undefined && settled[id] >= 0 && !graph.met[id] ? id : -1;
    };
    // the steps of the goals' plans, and per tower goal the steps of its levels' plans
    const inGoals = new Set(),
        towerSteps = [];
    const addPlan = (id, into) => {
        for (const x of steps[id]) into.add(x);
    };
    progress.towers.forEach((t, ti) => {
        if (t.active) return;
        const mine = new Set();
        for (const j of t.normal) {
            const id = has('l' + j);
            if (id >= 0) addPlan(id, mine);
        }
        for (const x of mine) inGoals.add(x);
        towerSteps.push([ti, t.req - t.solvedNormal, mine]);
    });
    levels.forEach((l, i) => {
        if (progress.state[i] === 'solved') return;
        const goal =
            (l.a && !hasAchievement(status, l.a)) || progress.state[i] === 'locked' || progress.state[i] === 'blocked';
        const id = goal ? has('l' + i) : -1;
        if (id >= 0) addPlan(id, inGoals);
    });
    PROG.freezers.forEach((fz, fi) => {
        if (progress.gateOpen[fi] || fz.judge) return;
        const id = has('g' + fi);
        if (id >= 0) addPlan(id, inGoals);
    });
    const listed = (id) => {
        const node = graph.node[id];
        return node?.t === 'l' && (node.front || progress.state[node.id] === 'blocked');
    };
    const entry = (i) => (out[i] ||= { towers: [], down: new Set() });
    for (const y of inGoals) {
        const node = graph.node[y];
        if (listed(y)) entry(node.id);
        if (node.t !== 'l' && node.t !== 'g') continue;
        for (const x of steps[y]) if (x !== y && listed(x)) entry(graph.node[x].id).down.add(graph.keys[y]);
    }
    for (const [ti, left, mine] of towerSteps)
        for (const x of mine) if (listed(x)) entry(graph.node[x].id).towers.push([ti, left]);
    // the steps toward the next ending not earned yet (its index in ENDINGS)
    const next = ENDINGS.findIndex(([, name]) => !hasAchievement(status, name)),
        endingLevel = next >= 0 ? levels.findIndex((l) => l.a === ENDINGS[next][1]) : -1,
        endingId = endingLevel >= 0 ? has('l' + endingLevel) : -1;
    if (endingId >= 0) for (const x of steps[endingId]) if (listed(x)) entry(graph.node[x].id).ending = next;
    return out;
}

// The group of an unsolved level in the lists: playable now, not reachable (the walk calls it unreachable) or locked
export function levelGroup(state) {
    if (state === 'locked') return 'locked';
    if (state === 'blocked') return 'blocked';
    return 'playable';
}
const GROUP_ORDER = { playable: 0, blocked: 1, locked: 2 };
const NO_NEXT_STEP = { towers: [], down: new Set(), ending: null };

// A level's ('l') or ice gate's ('g') role in a goal's list: the goal's role, else (no goal, or one without roles yet)
// the static one
function listRole(goal, kind, id) {
    const role = roleFor(goal, kind, id);
    if (role) return role;
    return roleOf(kind, id);
}

// The order of a goal's list (ids: unsolved levels, most with progress.needed set): the playable ones, then the ones the walk
// calls unreachable, then the locked ones; within each, the steps toward the next ending first, then by the tower a
// level brings closest to done, then by the levels and gates after it in the plans that the goal needs (on every route
// or on some), then by `dist`. Towers, levels and gates the `shown` tests leave out do not count.
export function orderNextSteps(progress, ids, shown, goal = null) {
    const required = (kind, id) => {
        const visible = kind === 'l' ? shown.level(id) : shown.gate(id);
        if (!visible) return false;
        const role = listRole(goal, kind, id);
        return role === 'req' || role === 'one';
    };
    const key = new Map(
        ids.map((i) => {
            const nd = progress.needed[i] || NO_NEXT_STEP;
            let closest = Infinity;
            for (const [ti, left] of nd.towers) if (shown.tower(ti) && left < closest) closest = left;
            let after = 0;
            for (const k of nd.down) if (required(k[0], Number(k.slice(1)))) after++;
            const group = GROUP_ORDER[levelGroup(progress.state[i])],
                towardEnding = nd.ending == null ? 1 : 0;
            return [i, [group, towardEnding, closest, -after, shown.dist(i)]];
        }),
    );
    return ids.toSorted((a, b) => {
        const x = key.get(a),
            y = key.get(b);
        for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] - y[k];
        return 0;
    });
}
