// The way into a level the walk cannot reach: the closed gates that lead into its pocket, less those it is
// behind only through itself (VIEWER.md "Pockets, leads and why", "Endgame way-in gates")
import { PROG } from '../data.js';
import { ICE } from '../walk/freezers.js';
import { MECHS } from '../walk/mechanics.js';
import { ROLE } from './level-roles.js';
import { gateOptionMet, levelsNeedingLevel, optionCount } from './unlocking.js';

// The strongly connected components of a graph (nodes 0..n-1, edges[x]: the nodes x points to), Tarjan's algorithm
// without recursion: per node its component's index
export function components(nodeCount, edges) {
    const index = new Int32Array(nodeCount).fill(-1),
        low = new Int32Array(nodeCount),
        component = new Int32Array(nodeCount).fill(-1),
        onStack = new Uint8Array(nodeCount),
        stack = [];
    let counter = 0,
        count = 0;
    for (let root = 0; root < nodeCount; root++) {
        if (index[root] >= 0) continue;
        // the walk: [node, the next edge to follow]
        const walk = [[root, 0]];
        index[root] = low[root] = counter++;
        stack.push(root);
        onStack[root] = 1;
        while (walk.length) {
            const top = walk[walk.length - 1],
                node = top[0];
            if (top[1] < edges[node].length) {
                const next = edges[node][top[1]++];
                if (index[next] < 0) {
                    index[next] = low[next] = counter++;
                    stack.push(next);
                    onStack[next] = 1;
                    walk.push([next, 0]);
                } else if (onStack[next]) low[node] = Math.min(low[node], index[next]);
                continue;
            }
            walk.pop();
            if (walk.length) {
                const parent = walk[walk.length - 1][0];
                low[parent] = Math.min(low[parent], low[node]);
            }
            if (low[node] !== index[node]) continue;
            for (;;) {
                const member = stack.pop();
                onStack[member] = 0;
                component[member] = count;
                if (member === node) break;
            }
            count++;
        }
    }
    return component;
}

// The closed gates that are no way in: their requirements can be met only from behind the gate itself, through any
// chain of gates and levels (VIEWER.md "Next steps"). Requirements (nodes: levels 0..L-1, then gates):
// - a level the walk cannot reach needs one of its way-in gates or of the levels by a pad (`via`);
// - a locked level its unsolved requirements (all, or one for an OR level) or the closed ice gate it is frozen in;
// - a closed ice gate its unmet levels (all, or one for an OR gate; an OR gate with a met option or a sign needs none).
// Each node needs any one of its `any` (one is enough to hold it back) or all of its `all`. A gate can need itself only
// inside a strongly connected component; per such gate, what cannot be met without it spreads back from it.
export function gatesBehindThemselves({ state, wayIn, via, ice, gateOpen, met }) {
    const levels = PROG.levels,
        freezers = PROG.freezers,
        nodeCount = levels.length + freezers.length;
    const any = Array.from({ length: nodeCount }, () => []),
        all = Array.from({ length: nodeCount }, () => []);
    const gateNode = (fi) => levels.length + fi;
    levels.forEach((l, i) => {
        if (state[i] === 'blocked') {
            all[i] = [...(wayIn[i] || []).map(gateNode), ...(via(i) || [])];
            return;
        }
        if (state[i] !== 'locked') return;
        const todo = l.req.filter((j) => state[j] !== 'solved');
        if (l.or && l.req.length > 1) all[i] = todo;
        else any[i] = todo;
        if (ice[i] !== undefined) any[i] = [...any[i], gateNode(ice[i])];
    });
    freezers.forEach((fz, fi) => {
        if (gateOpen[fi]) return;
        const id = gateNode(fi),
            todo = fz.req.filter((j) => !met(fz, j));
        if (fz.or && optionCount(fz) > 1) {
            if (todo.length === fz.req.length && !fz.signs?.length) all[id] = todo;
            return;
        }
        any[id] = todo;
    });
    const edges = any.map((xs, id) => [...xs, ...all[id]]);
    const component = components(nodeCount, edges);
    const size = new Int32Array(nodeCount);
    for (const c of component) size[c]++;
    // within a component, who needs each node
    const neededBy = Array.from({ length: nodeCount }, () => []);
    edges.forEach((xs, id) => {
        for (const x of xs) if (component[x] === component[id]) neededBy[x].push(id);
    });
    const candidates = new Set();
    for (const gates of wayIn) for (const fi of gates || []) if (size[component[gateNode(fi)]] > 1) candidates.add(fi);
    const membersOf = new Map();
    for (const fi of candidates) membersOf.set(component[gateNode(fi)], []);
    for (let id = 0; id < nodeCount; id++) membersOf.get(component[id])?.push(id);
    const behind = new Set(),
        held = new Uint8Array(nodeCount),
        left = new Int32Array(nodeCount);
    for (const fi of candidates) {
        const gate = gateNode(fi),
            members = membersOf.get(component[gate]);
        // an `all` with a part outside the component never waits on the gate alone
        for (const id of members) {
            held[id] = 0;
            const outside = all[id].some((x) => component[x] !== component[gate]);
            left[id] = all[id].length && !outside ? all[id].length : -1;
        }
        held[gate] = 1;
        const queue = [gate];
        while (queue.length) {
            const node = queue.pop();
            for (const user of neededBy[node]) {
                if (held[user]) continue;
                const byAny = any[user].includes(node);
                if (!byAny && (!all[user].includes(node) || --left[user] !== 0)) continue;
                held[user] = 1;
                queue.push(user);
            }
        }
        const needsItself =
            any[gate].some((x) => x !== gate && held[x]) || (all[gate].length > 0 && all[gate].every((x) => held[x]));
        if (needsItself) behind.add(fi);
    }
    return behind;
}

// per level, the levels requiring it
export function unlocksOf() {
    const L = PROG.levels;
    const unlocks = L.map(() => ({ levels: [] }));
    L.forEach((l, i) => l.req.forEach((j) => unlocks[j].levels.push(i)));
    return unlocks;
}
// per level, the closed gates whose leads or pocket hold it
export function gatesBehind(reach) {
    const behind = PROG.levels.map(() => []);
    for (const m of [reach?.leads, reach?.pocket]) m?.forEach((ls, fi) => ls.forEach((i) => behind[i].push(fi)));
    return behind;
}

// The levels the walk cannot reach: why (per level, the gates and mechanics that may still lead in), wayInOf() (per
// level, its way-in gates under the current level roles), wayInFixed (the levels whose way in is the level data's
// alone) and ice (per level, the closed ice gate it is frozen in). solved(i): whether level i is solved; unlocks:
// unlocksOf(); behind: gatesBehind(reach).
export function wayInModel({ levelFlags, solved, state, reach, unlocks, behind, gateOpen }) {
    const L = PROG.levels;
    const levelsNeeding = (i) => levelsNeedingLevel(L, unlocks, solved, i);
    // a closed gate is no way into a level when what it still needs is the level itself, levels the walk goes on from
    // to the level without it, or levels whose own requirements need the level (for an OR gate: every option, and it
    // has no sign)
    const inner = (fi, i, needing) => {
        const fz = PROG.freezers[fi],
            todo = fz.req.filter((j) => !gateOptionMet(fz, j, levelFlags)),
            within = (j) => j === i || !!reach.from.get(j)?.has(i) || needing.has(j);
        return fz.or && optionCount(fz) > 1
            ? !fz.signs?.length && todo.length > 0 && todo.every(within)
            : todo.some(within);
    };
    // why a level the walk cannot reach may still be: the closed gates that lead into its pocket (pad: those that lead
    // to a pad revealing one in the pocket, not into the pocket itself; via: the levels by such a pad) and the unmodelled
    // mechanics there; a level with neither has no known route
    const why = state.map((st, i) => {
        if (st !== 'blocked') return null;
        const needing = levelsNeeding(i),
            gates = behind[i].filter((fi) => !inner(fi, i, needing)),
            vp = reach.viaPads.get(i);
        return {
            gates,
            pad: gates.filter((fi) => vp?.gates.includes(fi)),
            via: (vp?.levels || []).filter((j) => state[j] !== 'solved'),
            mech: MECHS.filter((m, b) => (reach.mech[i] >> b) & 1),
        };
    });
    // wayIn: per level the walk cannot reach, the closed gates that are a way in: those leading into its pocket, else
    // (none leads in) the ones it sits behind from the start (the static roles), without the gates inner() rules out;
    // in the endgame areas, which the walk does not find its way into, the level data's way-in gates stand in
    // for those or fill in where there are none (progress.json endgame_way_ins)
    const endgameWayIn = new Map((PROG.endgame_way_ins || []).map(([i, gates, replace]) => [i, { gates, replace }]));
    const walkWayIn = (i) => {
        if (behind[i].length) return why[i].gates;
        const needing = levelsNeeding(i);
        return (ROLE?.bg.l[i] || []).filter((fi) => !gateOpen[fi] && !inner(fi, i, needing));
    };
    // the levels whose way in is the level data's alone (no levels by a pad either)
    const wayInFixed = new Set([...endgameWayIn].filter(([, row]) => row.replace).map(([i]) => i));
    // per level, the closed ice gate it is frozen in
    const ice = ICE.map((fi) => (fi !== undefined && !gateOpen[fi] ? fi : undefined));
    const gateMet = (fz, j) => gateOptionMet(fz, j, levelFlags);
    // the way-in gates, less the ones whose requirements can be met only from behind them (gatesBehindThemselves)
    const wayInOf = () => {
        const wayIn = state.map((st, i) => {
            if (st !== 'blocked') return null;
            const table = endgameWayIn.get(i),
                tableGates = table ? table.gates.filter((fi) => !gateOpen[fi]) : [];
            if (table?.replace) return tableGates;
            const gates = walkWayIn(i);
            return gates.length ? gates : tableGates;
        });
        const behindThemselves = gatesBehindThemselves({
            state,
            wayIn,
            via: (i) => (wayInFixed.has(i) ? [] : why[i]?.via),
            ice,
            gateOpen,
            met: gateMet,
        });
        if (!behindThemselves.size) return wayIn;
        return wayIn.map((gates) => gates && gates.filter((fi) => !behindThemselves.has(fi)));
    };
    return { why, wayInOf, wayInFixed, ice };
}

// per level the walk cannot reach on a layer where it reaches nothing (sky, underworld), that layer; else the sky,
// when the walk reaches nothing there and a fall from it lands in the level's pocket
export function accessOf(state, reach) {
    const layerReached = new Map(
        (PROG.map?.layers || []).map((layer) => [layer.key, !!reach?.cols[layer.key]?.some((v) => v)]),
    );
    return state.map((st, i) => {
        if (st !== 'blocked') return null;
        const z = PROG.levels[i].p[2],
            layer = (PROG.map?.layers || []).find((candidate) => z >= candidate.z[0] && z < candidate.z[1]);
        if (layer && layer.key !== 'ground' && !layerReached.get(layer.key)) return layer.key;
        if (reach?.fromSky[i] && !layerReached.get('sky')) return 'sky';
        return null;
    });
}
