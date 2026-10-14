// The flood: the cells a walk reaches from its seeds, and the pads it reveals through the map rooms (VIEWER.md
// "Moves", "Seeds and the reached cells", "Pads revealed through the map rooms")
import { endpointTarget } from './beams.js';
import { sink } from './bridges.js';
import { addTo, cellOnSide, BEAM, DIRS, GATE, neighbourOf, PUSH, SIDES, SOLID, THRU, ZB } from './cells.js';
import { openGateAhead, press } from './gates.js';
import { exists, withGroups } from './groups.js';
import { push, settle } from './queue.js';
import { layerAfterStep, swapCell, WIZARD } from './skills.js';
import { skipAndSwap } from './skipping-stones.js';
import { blocked } from './support.js';
import { padCell, padStep, reveals } from './teleporters.js';
import { fenced } from './walls.js';

// A flood's own state: its options, the cells it reached and its queue, and what its moves changed: the water cells
// its rock bridges fill (each Rock once), the shut switch gates it opened (`unlatched`) once it can bring an object onto
// every Switch of the flavor not pressed, the open notted gates the same presses shut (`latchedShut`), and the shut Gates
// it opened from an OPEN beam (`opened`). triggerHits: the reached [cell, layer] pairs on trigger cells, in the order
// they were reached.
function newFloodState(triggers, laneCount, outside, reveal, pocket) {
    return {
        outside,
        reveal,
        pocket,
        reached: [[], [], []],
        triggerHits: [],
        queue: [],
        bridged: new Set(),
        unlatched: new Set(),
        latchedShut: new Set(),
        opened: new Set(),
        majorDone: [false, false, false],
        latched: new Set(),
        sinkCursor: { at: 0 },
        bridgeTaken: new Uint8Array(triggers.bridges.length),
        bridgesDue: [],
        pressCursor: { at: 0 },
        switchesLeft: triggers.switchCount.slice(),
        switchesReached: new Set(),
        laneCursor: { at: 0 },
        laneParts: new Uint8Array(laneCount),
        lanesDue: [],
    };
}
// the triggers of no flood: no rock bridges and no Switch flavors
const NO_TRIGGERS = { bridges: [], switchCount: new Int32Array(0) };
// the state of no flood, which the helpers read while the walker is built and between floods: nothing opened or shut
export function noFloodState() {
    return newFloodState(NO_TRIGGERS, 0, null, true, false);
}
// Per cell, the rock bridges, Switch flavors and skip lanes whose reach that cell can fire, so a flood that drains its
// queue checks only what the cells reached since its last look touched. Bridges: by push cell. Flavors (in latch
// order, the order the flood presses them in): by Switch cell not pressed, with the number of such cells. Lanes: by
// launch push cell and the cells next to the stone (layer 0), line cells (TELEPORT layer) and ride cells (any layer,
// for a pocket flood).
export function triggerIndex(walkGrid) {
    const bridges = [...walkGrid.bridgesOf],
        bridgesAt = new Map();
    bridges.forEach(([, ways], n) => {
        for (const [pushCell] of ways) addTo(bridgesAt, pushCell, n);
    });
    const flavors = [...walkGrid.latch].map(([flavor, { open, shut }]) => ({ flavor, open, shut })),
        switchesAt = new Map(),
        switchCount = new Int32Array(flavors.length);
    flavors.forEach(({ flavor }, n) => {
        const cells = new Set(walkGrid.unpressed.get(flavor));
        switchCount[n] = cells.size;
        for (const c of cells) addTo(switchesAt, c, n);
    });
    const lanePushAt = new Map(),
        laneNearAt = new Map(),
        laneFromAt = new Map(),
        laneRideAt = new Map();
    walkGrid.lanes.forEach((lane, n) => {
        addTo(lanePushAt, lane.pushCell, n);
        for (const c of new Set(lane.near)) addTo(laneNearAt, c, n);
        for (const c of new Set(lane.from)) addTo(laneFromAt, c, n);
        for (const c of new Set(lane.ride)) addTo(laneRideAt, c, n);
    });
    // 1 on every cell some trigger is indexed by
    const cells = new Uint8Array(walkGrid.grid.length);
    for (const byCell of [bridgesAt, switchesAt, lanePushAt, laneNearAt, laneFromAt, laneRideAt])
        for (const k of byCell.keys()) if (k >= 0) cells[k] = 1;
    return {
        cells,
        bridges,
        bridgesAt,
        flavors,
        switchesAt,
        switchCount,
        lanePushAt,
        laneNearAt,
        laneFromAt,
        laneRideAt,
    };
}
// Reaching an enabled MAJOR world pad discovers the pads its chain reveals. The pad sends the hero to its twin in a
// map room (its target); from there the hero walks to a revealed pad's twin (a map-room pad targeting it), so a
// revealed pad counts only when a walk on foot (no pads, no elevators) joins the two twins. Discovery enables the
// world pads and their twins, which makes each one's own Group and also_exist_this_group_id Group exist, so the
// twins' own existence is not asked and the walk runs with those Groups (withGroups).
export function placeTwins(walkGrid) {
    const { teleporters: T, teleporterIndex, twinsOf } = walkGrid;
    T.forEach((t, i) => {
        if (t.l >= 3 && teleporterIndex.has(t.target)) addTo(twinsOf, teleporterIndex.get(t.target), i);
    });
    walkGrid.twinCells = [...twinsOf.values()].flat().map((ti) => padCell(walkGrid, walkGrid.noFlood, ti));
}
// the pocket a walk on foot from the cell of pad ti reaches (an id per pocket, -1 without a cell)
function padComponentOf(walkGrid, ti) {
    const components = walkGrid.padComponents,
        cell = padCell(walkGrid, walkGrid.noFlood, ti);
    if (cell >= 0 && !components.has(cell)) {
        const reached = flood(walkGrid, [cell], null, null, { reveal: false, travel: false }),
            id = components.size;
        for (const twinCell of [cell, ...walkGrid.twinCells])
            if (reached.has(twinCell) && !components.has(twinCell)) components.set(twinCell, id);
    }
    if (cell < 0) return -1;
    return components.get(cell);
}
function linked(walkGrid, pad, padTwin, revealed, revealedTwin) {
    const T = walkGrid.teleporters,
        groups = [pad, padTwin, revealed, revealedTwin].flatMap((ti) => [T[ti].g, T[ti].ag]);
    return withGroups(walkGrid, groups, (changed) => {
        if (!changed)
            return (
                padComponentOf(walkGrid, padTwin) >= 0 &&
                padComponentOf(walkGrid, padTwin) === padComponentOf(walkGrid, revealedTwin)
            );
        const c = padCell(walkGrid, walkGrid.noFlood, padTwin),
            d = padCell(walkGrid, walkGrid.noFlood, revealedTwin);
        return c >= 0 && d >= 0 && flood(walkGrid, [c], null, null, { reveal: false, travel: false }).has(d);
    });
}
// per pad, the existing world pads that reaching it reveals
export function revealedPadsOf(walkGrid) {
    const { teleporters: T, teleporterStates: tst, teleporterIndex, twinsOf } = walkGrid;
    return reveals(T).map((revealed, i) => {
        const t1 = teleporterIndex.get(T[i].target);
        if (!T[i].major || !tst[i].en || t1 === undefined) return [];
        return revealed.filter(
            (q) =>
                exists(walkGrid, T[q].pid, T[q].ex) &&
                (twinsOf.get(q) || []).some((t2) => linked(walkGrid, i, t1, q, t2)),
        );
    });
}
// Three layers: 0 any skill, 1 PROTECTION, 2 TELEPORT (a hero who left a TELEPORT Wardrobe by its door, who pushes
// nothing and swaps); a seed is a cell (layer 0) or [cell, layer]. Options: reveal = false leaves out the pads that
// reaching a pad reveals (one-way edges, for pockets of cells); travel = false leaves out pads and elevators (a walk on
// foot); pocket = true walks a pocket of cells both ways along its one-way edges: every rock bridge's water cell holds
// the hero, and skip lanes are walked backwards. Returns the reached cells, in the order they were reached in each
// layer.
export function flood(walkGrid, seeds, outside, front, { reveal = true, travel = true, pocket = false } = {}) {
    if (walkGrid.activeFlood) throw new Error('flood() called inside a flood of the same walker');
    const floodState = newFloodState(walkGrid.triggers, walkGrid.lanes.length, outside, reveal, pocket);
    walkGrid.activeFlood = floodState;
    const { grid, cellFlags, frozen, width, height, layerCells, visited } = walkGrid,
        { alterCells, endpointBeams, doubleBeams, squeezeCells, mirrorHops, elevatorsAt } = walkGrid,
        queue = floodState.queue;
    try {
        for (const s of seeds) {
            if (Array.isArray(s)) push(walkGrid, floodState, s[0], s[1]);
            else push(walkGrid, floodState, s, 0);
        }
        while (
            queue.length ||
            (walkGrid.bridgesOf.size && sink(walkGrid, floodState) && queue.length) ||
            (walkGrid.latch.size && press(walkGrid, floodState) && queue.length) ||
            (walkGrid.lanes.length && skipAndSwap(walkGrid, floodState) && queue.length)
        ) {
            const layer = queue.pop(),
                cell = queue.pop(),
                i = cell % width,
                j = Math.floor(cell / width) % height,
                zr = cell - i - j * width,
                z = zr / layerCells - ZB,
                altered = alterCells.has(cell),
                ep = endpointBeams.get(cell),
                steps = (altered ? 3 : 2) ** (doubleBeams.get(cell) || 0);
            for (let s = 0; s < 4; s++) {
                const [dx, dy] = DIRS[s],
                    side = SIDES[s],
                    e0 = ep?.find((endpointBeam) => endpointBeam.side % 2 === side % 2);
                openGateAhead(walkGrid, floodState, cell, side, altered);
                // an ENDPOINT or DOUBLE move checks its destination only (fences: on the start and destination cells)
                let target = e0 ? endpointTarget(e0, e0.side === side, altered) : neighbourOf(walkGrid, cell, dx, dy);
                if (!e0) for (let c = steps; c > 1; c--) target = cellOnSide(walkGrid, target, side);
                // a jump along a beam at infinity leaves the map
                if (target < 0) continue;
                if (target === cell || (!squeezeCells.has(cell) && fenced(walkGrid, cell, side, target))) continue;
                // a step into what the hero pushes moves it one cell on, unless that cell is blocked (one push: no
                // chains, MULTIPUSH or PULL); a Wardrobe skill replaces SINGLE_PUSH, so a hero with PROTECTION or
                // TELEPORT pushes nothing
                if (grid[target] & PUSH) {
                    if (layer) continue;
                    const b = cellOnSide(walkGrid, target, side);
                    if (
                        b === cell ||
                        blocked(walkGrid, floodState, b) ||
                        grid[b] & PUSH ||
                        fenced(walkGrid, target, side, b)
                    )
                        continue;
                }
                if (blocked(walkGrid, floodState, target)) {
                    if (front && frozen.has(target) && !(grid[target] & (SOLID | GATE))) front.add(frozen.get(target));
                    continue;
                }
                // a beam's wall cell is entered only from the beam
                if (cellFlags[target] & THRU && !(cellFlags[cell] & BEAM)) continue;
                settle(walkGrid, floodState, target, z, layerAfterStep(walkGrid, cell, side, target, layer));
            }
            // a hero with TELEPORT swaps with the first target along each side
            if (layer === WIZARD)
                for (const side of SIDES) {
                    const n = swapCell(walkGrid, floodState, cell, side);
                    if (n >= 0) settle(walkGrid, floodState, n, z, layer);
                }
            // ACTIVATE on a magic Mirror's arm
            const landings = mirrorHops.get(cell);
            if (landings)
                for (const n of landings)
                    if (!blocked(walkGrid, floodState, n)) settle(walkGrid, floodState, n, z, layer);
            if (!travel) continue;
            const frames = elevatorsAt.get(cell);
            if (frames)
                for (const o of frames) if (!blocked(walkGrid, floodState, o)) push(walkGrid, floodState, o, layer);
            padStep(walkGrid, floodState, cell, layer);
        }
    } finally {
        for (const cells of floodState.reached) for (const cell of cells) visited[cell] = 0;
        walkGrid.activeFlood = null;
    }
    const out = new Set(floodState.reached[0]);
    for (const cells of floodState.reached.slice(1)) for (const cell of cells) out.add(cell);
    return out;
}
