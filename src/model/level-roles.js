// Level roles from the walk on the level data (VIEWER.md "Level roles (viewer)")
import { PROG, WORLD } from '../data.js';
import { STATIC_ROLES } from '../walk-data.js';
import { addTo, DIRS } from '../walk/cells.js';
import { ICE } from '../walk/freezers.js';
import { NO_HISTORY } from '../walk/reachability.js';
import { teleporterStatesOf } from '../walk/teleporters.js';
import { walker } from '../walk/walker.js';
import { optionCount } from './unlocking.js';

// Level roles (VIEWER.md "Level roles (viewer)"): the walk on the level data from a new game's start, opening the closed ice
// gates on the edge of the reached cells in rounds. need: 2 Required, 1 Required as one of several, 0 Optional, per
// level ('l') and ice gate ('g'); bg: the ice gates each sits behind.
export function staticRoles() {
    const levels = PROG.levels,
        freezers = PROG.freezers,
        start = PROG.fog?.start;
    if (!start?.hero || !PROG.world || !WORLD) return null;
    const { flood, land, cellOf, neighbourOf, frozen, layerCells } = walker(
        NO_HISTORY,
        teleporterStatesOf(null),
        freezers.map(() => true),
    );
    const gateCells = new Map([...frozen].map(([k, fi]) => [fi, k])),
        pins = new Map(PROG.world.area_pins.map(([pid, ...p]) => [pid, p]));
    const seeds = [
        land(cellOf(...start.hero)),
        ...(start.pins || []).filter((p) => pins.has(p)).map((p) => land(cellOf(...pins.get(p)), false)),
    ];
    const inside = (S, k) => S.has(k) || S.has(land(k)),
        levelCells = levels.map((l) => cellOf(...l.p));
    let front = new Set();
    const reached = flood(seeds, null, front),
        levelGates = new Map(),
        gatesBehindGate = new Map([...front].map((g) => [g, []]));
    // a level frozen in an ice gate sits behind that gate alone, whatever the walk reaches next to it
    levels.forEach((l, i) => {
        if (ICE[i] !== undefined) levelGates.set(i, [ICE[i]]);
        else if (inside(reached, levelCells[i])) levelGates.set(i, []);
    });
    const opens = new Map(),
        bumpedInRound = new Map([...front].map((g) => [g, 0])),
        snaps = [new Set(reached)];
    while (front.size) {
        const roundGates = [...front].toSorted((a, b) => freezers[a].pid - freezers[b].pid),
            alone = new Map();
        for (const g of roundGates) {
            const c = gateCells.get(g);
            frozen.delete(c);
            const bumped = new Set();
            alone.set(g, { cells: flood([land(c)], reached, bumped), bumped });
            frozen.set(c, g);
        }
        for (const g of roundGates) frozen.delete(gateCells.get(g));
        front = new Set();
        const roundCells = flood(
            roundGates.map((g) => land(gateCells.get(g))),
            reached,
            front,
        );
        // what no gate reaches alone is behind every gate of the round
        const orRound = (gs) => (gs.length ? gs : roundGates);
        levels.forEach((l, i) => {
            if (!levelGates.has(i) && inside(roundCells, levelCells[i]))
                levelGates.set(i, orRound(roundGates.filter((g) => inside(alone.get(g).cells, levelCells[i]))));
        });
        for (const h of front)
            if (!gatesBehindGate.has(h))
                gatesBehindGate.set(h, orRound(roundGates.filter((g) => alone.get(g).bumped.has(h))));
        const cols = new Set(roundGates.map((g) => gateCells.get(g) % layerCells));
        for (const c of roundCells) {
            if (cols.has(c % layerCells)) continue;
            const gs = orRound(roundGates.filter((g) => alone.get(g).cells.has(c)));
            for (const g of gs) opens.set(g, Math.max(opens.get(g) || 0, gs.length === 1 ? 2 : 1));
        }
        for (const c of roundCells) reached.add(c);
        for (const h of front) if (!bumpedInRound.has(h)) bumpedInRound.set(h, snaps.length);
        snaps.push(new Set(reached));
    }
    const cellsByColumn = new Map();
    for (const c of reached) addTo(cellsByColumn, c % layerCells, c);
    // one move from a to b without passing other reached cells
    const step = (a, b) => {
        const da = reached.delete(a),
            db = reached.delete(b),
            hit = flood([a], reached).has(b);
        if (da) reached.add(a);
        if (db) reached.add(b);
        return hit;
    };
    for (const [gate, round] of bumpedInRound) {
        if (opens.has(gate)) continue;
        const c = land(gateCells.get(gate)),
            at = (dx, dy) => cellsByColumn.get(neighbourOf(c, dx, dy) % layerCells) || [];
        const through =
            c >= 0 &&
            DIRS.some(([dx, dy]) =>
                at(dx, dy).some((a) => snaps[round].has(a) && step(a, c) && at(-dx, -dy).some((b) => step(c, b))),
            );
        if (!through) opens.set(gate, 2);
    }
    const sorted = (m) => (m || []).toSorted((a, b) => a - b);
    const bg = {
        l: levels.map((l, i) => sorted(levelGates.get(i))),
        g: freezers.map((f, fi) => sorted(gatesBehindGate.get(fi))),
    };
    const need = { l: new Uint8Array(levels.length), g: new Uint8Array(freezers.length) },
        todo = [];
    const mark = (kind, i, strong) => {
        const v = strong ? 2 : 1;
        if (need[kind][i] < v) {
            need[kind][i] = v;
            todo.push([kind, i]);
        }
    };
    // a tower needs N of its M normal levels, so each is one of several unless it needs them all
    const towerNeedsAll = new Map(
        PROG.towers.map((t) => [t.t, t.req >= levels.filter((l) => l.t === t.t && !l.d).length]),
    );
    levels.forEach((l, i) => {
        if (l.a) mark('l', i, true);
        else if (l.t && !l.d) mark('l', i, towerNeedsAll.get(l.t));
    });
    // a gate the walk never reaches may guard anything
    freezers.forEach((f, fi) => {
        const v = gatesBehindGate.has(fi) ? opens.get(fi) || 0 : 2;
        if (v) mark('g', fi, v === 2);
    });
    while (todo.length) {
        const [kind, i] = todo.pop(),
            strong = need[kind][i] === 2,
            node = kind === 'l' ? levels[i] : freezers[i],
            b = bg[kind][i];
        const many = node.or && optionCount(node) > 1;
        // a level enabled in the level data is open whatever its requirements
        if (kind === 'g' || !node.en) for (const j of node.req) mark('l', j, strong && !many);
        for (const fi of b) mark('g', fi, strong && b.length === 1);
    }
    return { need, bg };
}

// the static level roles, from data/walk.json
export const ROLE = STATIC_ROLES;
// Required / Optional by kind ('l' level, 'g' ice gate) and index; null without static roles
export function roleOf(kind, i) {
    if (!ROLE) return null;
    if (ROLE.need[kind][i]) return 'req';
    return 'optional';
}
