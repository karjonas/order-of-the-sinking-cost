// The requirement graph the plans are worked out over (VIEWER.md "The requirement graph")
import { PROG } from '../data.js';
import { ENDINGS, MARKER_RANKS } from './achievements.js';

export const SIGN_INDEX = new Map((PROG.signs || []).map((sg, i) => [sg.pid, i]));

// A requirement is met (nothing to do), a step with parts, or a part with no step of its own (an option list inside a
// step). A step or part needs all its parts (AND), the cheapest one of them (OR), or the cheapest `k` of them (k of n).
// Nodes of the plans: levels (l), ice gates (g), sign rules (s), towers (t).
//   level, solved: met. Playable now (entered, partly solved or reachable): a step with no parts (`front`).
//   level, locked: its unsolved requirements (all, or the cheapest one for an OR gate), and a closed ice gate it is
//     frozen in.
//   level, not reachable: the cheapest of its way-in gates (progress.wayIn) and the levels by a pad that reveals one in its
//     pocket; with none, on a layer the walk reaches nowhere, the way onto that layer (a); else, when it has none, or
//     none has a plan and each gate only leads to such a pad, a step of its own.
//   ice gate, open: met. Closed: its unmet levels and signs (all, or the cheapest one for an OR gate; an OR gate with one
//     met opens at the next overworld load, a step with no parts).
//   sign: a tower sign whose tower is not active needs the tower; a rank sign the rank; the gold room sign the
//     cheapest gold rooms (p) still to find, each its tower.
//   rank r (a part): the cheapest of the ENDGAME levels and the rank markers (e: ASCEND, DESCEND) that give r or more.
//   tower, active: met. Else the cheapest of its unsolved levels, as many as it still needs.
class Graph {
    constructor() {
        this.keys = [];
        this.index = new Map();
        // per requirement: the plan node (null for a part), 'and' | 'or' | 'k', k, part ids, met
        this.node = [];
        this.kind = [];
        this.k = [];
        this.parts = [];
        this.met = [];
        // a step of its own once nothing else gives it a plan
        this.fallback = [];
    }
    add(key, node, kind = 'and', parts = [], k = 0) {
        const id = this.keys.length;
        this.keys.push(key);
        this.index.set(key, id);
        this.node.push(node);
        this.kind.push(kind);
        this.k.push(k);
        this.parts.push(parts);
        this.met.push(false);
        this.fallback.push(false);
        return id;
    }
}

export function requirementGraph(progress) {
    const levels = PROG.levels,
        freezers = PROG.freezers,
        graph = new Graph();
    const levelId = levels.map((l, i) => graph.add('l' + i, { t: 'l', id: i })),
        gateId = freezers.map((f, fi) => graph.add('g' + fi, { t: 'g', id: fi })),
        towerId = progress.towers.map((t, ti) => graph.add('t' + ti, { t: 't', id: ti })),
        signIds = new Map();
    // the endings (PROGRESSION.md "Endings"): a rank r is the cheapest of the ways to it or past it, the ENDGAME levels
    // and the ASCEND and DESCEND markers. The way onto the sky (its pieces wait in rank 1 ice gates) comes after rank 1
    // and the way into the underworld after the sky, each a step of its own while the walk does not find it; ASCEND
    // and DESCEND stand on those layers.
    const access = new Map(),
        rankId = new Map(),
        ranked = [];
    const rankOk = (r) => progress.signOk({ rank: r });
    for (const [rank, name] of ENDINGS) {
        const i = levels.findIndex((l) => l.a === name);
        if (i >= 0) ranked.push([rank, levelId[i]]);
    }
    for (const r of new Set([1, 3, 5, ...freezers.flatMap((f) => (f.signs || []).map((g) => g.rank || 0))])) {
        if (!r || r === 255) continue;
        const id = graph.add('r' + r, null, 'or');
        if (rankOk(r)) graph.met[id] = true;
        rankId.set(r, id);
    }
    const accessId = (layer) => access.get(layer);
    access.set('sky', graph.add('a:sky', { t: 'a', id: 'sky' }, 'and', [rankId.get(1)]));
    access.set('underworld', graph.add('a:underworld', { t: 'a', id: 'underworld' }, 'and', [accessId('sky')]));
    for (const [name, rank, layer] of MARKER_RANKS) {
        const id = graph.add('e:' + name, { t: 'e', id: name }, 'and', [accessId(layer)]);
        if (rankOk(rank)) graph.met[id] = true;
        ranked.push([rank, id]);
    }
    for (const [r, id] of rankId) graph.parts[id] = ranked.filter(([rank]) => rank >= r).map(([, source]) => source);
    // a gold room is found by stepping on its tower's MINOR pad once the tower is active
    const roomId = (PROG.gold_rooms || []).map((room, ri) => {
        const id = graph.add('p' + ri, { t: 'p', id: ri });
        if (progress.tst?.[room.endpoint]?.disc) graph.met[id] = true;
        else if (progress.towers[room.tower]) graph.parts[id] = [towerId[room.tower]];
        return id;
    });
    const signId = (g, fi, k) => {
        const si = SIGN_INDEX.get(g.pid),
            key = si != null ? 's' + si : 'x' + fi + ':' + k;
        if (!signIds.has(key)) {
            const id = graph.add(key, { t: 's', id: si, g });
            signIds.set(key, id);
            if (progress.signOk(g)) graph.met[id] = true;
            else if (g.tower != null && progress.towers[g.tower]) graph.parts[id] = [towerId[g.tower]];
            else if (g.rank && rankId.has(g.rank)) graph.parts[id] = [rankId.get(g.rank)];
            else if (g.gold) {
                graph.kind[id] = 'k';
                graph.k[id] = g.gold - (progress.goldFound || 0);
                graph.parts[id] = roomId.filter((room) => !graph.met[room]);
            }
        }
        return signIds.get(key);
    };
    (PROG.signs || []).forEach((g, si) => signId(g, null, si));
    // every way-in gate of a level the walk cannot reach only leads to a pad that reveals one in its pocket
    const onlyPadGates = (i, gs) => {
        if (!gs.length) return true;
        if (!progress.behind[i].length) return false;
        const pad = new Set(progress.why[i].pad);
        return gs.every((fi) => pad.has(fi));
    };
    levels.forEach((l, i) => {
        const id = levelId[i],
            st = progress.state[i];
        if (st === 'solved') {
            graph.met[id] = true;
            return;
        }
        if (st === 'visited' || st === 'partial' || st === 'unlocked') {
            graph.node[id].front = true;
            return;
        }
        if (st === 'locked') {
            const todo = l.req.filter((j) => progress.state[j] !== 'solved').map((j) => levelId[j]);
            let parts = todo;
            if (l.or && l.req.length > 1) {
                graph.node[id].alt = todo.length;
                parts = [graph.add('o' + i, null, 'or', todo)];
            }
            const fi = progress.ice?.[i];
            if (fi !== undefined) parts = [...parts, gateId[fi]];
            graph.parts[id] = parts;
            return;
        }
        graph.node[id].alt = 0;
        const gs = progress.wayIn[i] || [],
            via = progress.wayInFixed?.has(i) ? [] : progress.why[i]?.via || [];
        graph.kind[id] = 'or';
        graph.parts[id] = [...gs.map((fi) => gateId[fi]), ...via.map((j) => levelId[j])];
        if (!graph.parts[id].length && progress.access?.[i]) {
            // on a layer the walk reaches nowhere, with no gate leading in: it needs the way onto the layer
            graph.kind[id] = 'and';
            graph.parts[id] = [accessId(progress.access[i])];
            return;
        }
        if (onlyPadGates(i, gs)) graph.fallback[id] = true;
        if (!graph.parts[id].length && graph.fallback[id]) graph.kind[id] = 'and';
    });
    freezers.forEach((fz, fi) => {
        const id = gateId[fi];
        if (progress.gateOpen[fi]) {
            graph.met[id] = true;
            return;
        }
        const met = (j) => progress.state[j] === 'solved' || (fz.partial && progress.state[j] === 'partial');
        const items = [
            ...fz.req.map((j) => ({ met: met(j), id: levelId[j] })),
            ...(fz.signs || []).map((g, k) => ({ met: progress.signOk(g), id: signId(g, fi, k) })),
        ];
        const todo = items.filter((it) => !it.met).map((it) => it.id);
        if (fz.or && items.length > 1) {
            if (todo.length < items.length) return;
            graph.kind[id] = 'or';
            graph.node[id].alt = todo.length;
        }
        graph.parts[id] = todo;
    });
    progress.towers.forEach((t, ti) => {
        const id = towerId[ti];
        if (t.active) {
            graph.met[id] = true;
            return;
        }
        graph.kind[id] = 'k';
        graph.k[id] = t.req - t.solvedNormal;
        graph.parts[id] = t.normal.filter((j) => progress.state[j] !== 'solved').map((j) => levelId[j]);
    });
    return graph;
}
