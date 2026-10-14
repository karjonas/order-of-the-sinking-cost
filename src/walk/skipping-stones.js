// Skipping stones: the skip lanes and the TELEPORT swap onto a stone (MOVEMENT.md "Skipping stones", VIEWER.md "Skip
// lanes and the TELEPORT swap")
import { rawU16 } from '../save.js';
import { cellOnSide, DIRS, neighbourOf, PUSH, ZB } from './cells.js';
import { exists } from './groups.js';
import { lilyRide } from './lilies-and-rivers.js';
import { deep, levelWater, waterAt } from './ocean.js';
import { push, visitReached } from './queue.js';
import { doorIn, doorOut, WIZARD } from './skills.js';
import { blocked, heldFromBelow, holdsStone, standable } from './support.js';
import { fenced, latestCell } from './walls.js';

// the parts of a skip lane a flood reaches before the swap: its launch push cell, a cell next to the stone, a line cell
const LANE_PUSH = 1,
    LANE_NEAR = 2,
    LANE_FROM = 4,
    LANE_READY = 7;

// Skip lanes, for the TELEPORT swap onto a skipping stone. A SKIPPABLE Rock (where the save last left it, unless it
// sank) is pushed over dry cells and launched into water level with its z (surface within 0.5); it skips straight
// on to the first cell that holds it or a cell a Lily drifts through (landingsOf), and is lost at a wall, a Rock or
// a Fence. A hero with TELEPORT standing on a line from that landing cell (it runs in each direction until a wall, a
// shut Gate, a frozen cell, a target or a Wardrobe door edge) swaps onto the stone. A stone that lands on a Lily rides
// it, and so does a hero who swaps onto it, who can step off anywhere along the ride. Per lane: the stone's cell, the
// launch push cell, the landing cell, the ride (the landing cell, then the cells a Lily there drifts through), the line
// cells from the ride the hero can stand in and those of them past a gap in the line, and the cells next to the stone.
export function skipLanes(walkGrid) {
    const { world, grid, latest, lilyCells, liliesAt, driftCells, width, height, layerCells } = walkGrid;
    const lanes = [],
        stones = new Set(world.skippable || []);
    // [side, push cell, first water cell] of each launch from the cells the stone is pushed to over dry land
    const launchesOf = (stoneCell, z) => {
        const positions = new Set([stoneCell]),
            todo = [stoneCell],
            launches = [];
        while (todo.length && positions.size < 200) {
            const position = todo.pop();
            for (let side = 0; side < 4; side++) {
                const pushCell = cellOnSide(walkGrid, position, (side + 2) % 4),
                    into = cellOnSide(walkGrid, position, side);
                if (
                    pushCell === stoneCell ||
                    blocked(walkGrid, walkGrid.noFlood, pushCell) ||
                    !standable(walkGrid, walkGrid.noFlood, pushCell)
                )
                    continue;
                if (fenced(walkGrid, pushCell, side, position) || fenced(walkGrid, position, side, into)) continue;
                if (into !== stoneCell && (blocked(walkGrid, walkGrid.noFlood, into) || grid[into] & PUSH)) continue;
                if (holdsStone(walkGrid, walkGrid.noFlood, into, z)) {
                    if (positions.has(into)) continue;
                    positions.add(into);
                    todo.push(into);
                } else if (levelWater(walkGrid, into, z)) launches.push([side, pushCell, into]);
            }
        }
        return launches;
    };
    const lineCells = (landing, z) => {
        const from = [],
            cross = [];
        for (let side = 0; side < 4; side++) {
            const back = (side + 2) % 4;
            let gap = false;
            for (
                let prev = landing, cell = cellOnSide(walkGrid, landing, side), m = 0;
                m < width + height && cell !== landing;
                m++
            ) {
                if (blocked(walkGrid, walkGrid.noFlood, cell) || grid[cell] & PUSH) break;
                if (doorOut(walkGrid, cell, back) >= 0 || doorIn(walkGrid, prev, back) >= 0) break;
                const wz = waterAt(walkGrid, cell % layerCells, z);
                if (standable(walkGrid, walkGrid.noFlood, cell) && !(wz != null && z < wz - 0.1)) {
                    from.push(cell);
                    if (gap) cross.push(cell);
                    gap = false;
                } else gap = true;
                prev = cell;
                cell = cellOnSide(walkGrid, cell, side);
            }
        }
        return { from, cross };
    };
    for (const [pid, i, j, z0, ex] of world.rocks) {
        if (!stones.has(pid) || !exists(walkGrid, pid, ex)) continue;
        const properties = latest.get(pid, 'properties');
        if (properties && (rawU16(properties) & 8 || !(rawU16(properties) & 2))) continue;
        const stoneCell = latestCell(walkGrid, pid, i, j, z0);
        if (stoneCell < 0) continue;
        const z = Math.floor(stoneCell / layerCells) - ZB;
        if (deep(walkGrid, stoneCell)) continue;
        walkGrid.stoneCells.add(stoneCell);
        const launches = launchesOf(stoneCell, z).flatMap(([side, pushCell, first]) =>
            landingsOf(walkGrid, walkGrid.noFlood, side, first, z).map((landing) => [side, pushCell, landing]),
        );
        for (const [side, pushCell, landing] of launches) {
            let ride = [landing];
            if (lilyCells.has(landing) || driftCells.has(landing)) ride = lilyRide(walkGrid, landing, side, z);
            // the Lily the stone rides carries no hero, so a cell that only it holds up is no line cell
            const riding = liliesAt.get(landing);
            const onlyRidingLily = (c) => {
                if (riding?.size !== 1 || heldFromBelow(walkGrid, walkGrid.noFlood, c)) return false;
                const there = liliesAt.get(c);
                return there?.size === 1 && riding.has(there.values().next().value);
            };
            const near = DIRS.map(([dx, dy]) => neighbourOf(walkGrid, stoneCell, dx, dy));
            // one lane per ride cell the hero swaps into and the end of the ride from there: the whole rest of the
            // ride, or up to the line cell the hero swapped from when it lies ahead on the ride (the stone, swapped
            // into that cell, stops the Lily there)
            ride.forEach((cell, rideIndex) => {
                const lines = lineCells(cell, z),
                    pastGap = new Set(lines.cross),
                    byEnd = new Map();
                for (const fromCell of lines.from) {
                    if (onlyRidingLily(fromCell)) continue;
                    const ahead = ride.indexOf(fromCell, rideIndex + 1),
                        end = ahead < 0 ? ride.length : ahead;
                    if (!byEnd.has(end)) byEnd.set(end, { from: [], cross: [] });
                    byEnd.get(end).from.push(fromCell);
                    if (pastGap.has(fromCell)) byEnd.get(end).cross.push(fromCell);
                }
                for (const [end, { from, cross }] of byEnd)
                    lanes.push({
                        stone: stoneCell,
                        pushCell,
                        landing,
                        ride: ride.slice(rideIndex, end),
                        from,
                        cross,
                        near,
                    });
            });
        }
    }
    return lanes;
}
// whether a stone skipping at height z goes on over `cell`: water level with z that holds no stone or that a Lily
// drifts through (the stone can also stop there)
export function skipsOver(walkGrid, floodState, cell, z) {
    if (!levelWater(walkGrid, cell, z)) return false;
    return walkGrid.driftCells.has(cell) || !holdsStone(walkGrid, floodState, cell, z);
}
// the cells a stone skipping `side` from water cell `first` can stop on: each cell of a Lily's drift it crosses (the
// launch is timed for the Lily to be there), then the first cell that holds it; none past a cell where it is lost
export function landingsOf(walkGrid, floodState, side, first, z) {
    const { grid, driftCells } = walkGrid;
    const landings = [];
    let cur = first;
    for (let c = 0; c < walkGrid.width + walkGrid.height; c++) {
        const next = cellOnSide(walkGrid, cur, side);
        if (fenced(walkGrid, cur, side, next) || blocked(walkGrid, floodState, next) || grid[next] & PUSH) break;
        if (driftCells.has(next) && levelWater(walkGrid, next, z)) {
            landings.push(next);
            cur = next;
            continue;
        }
        if (holdsStone(walkGrid, floodState, next, z)) {
            landings.push(next);
            break;
        }
        if (!levelWater(walkGrid, next, z)) break;
        cur = next;
    }
    return landings;
}
// The TELEPORT swap onto a skipping stone, in the order the skills allow: the stone is pushed and launched (layer 0,
// SINGLE_PUSH; a cell next to it reached), then a hero with TELEPORT (layer 2) stands on a line cell and swaps onto
// the landing cell. A pocket flood looks for the ways into its pocket, so it walks a lane backwards only: from the
// landing cell to the launch push cell and to the line cells past a gap. Per lane, which of its parts the walk has
// reached (LANE_* bits; a pocket flood needs a ride cell only), and the lanes with every part reached that have not
// swapped yet.
function reachLanePart(floodState, lanesThere, part) {
    const laneParts = floodState.laneParts;
    for (const n of lanesThere || []) {
        if (laneParts[n] & part) continue;
        laneParts[n] |= part;
        if (laneParts[n] === LANE_READY) floodState.lanesDue.push(n);
    }
}
function countLanes(walkGrid, floodState, cell, layer) {
    const triggers = walkGrid.triggers;
    if (floodState.pocket) {
        reachLanePart(floodState, triggers.laneRideAt.get(cell), LANE_READY);
        return;
    }
    if (layer === 0) {
        reachLanePart(floodState, triggers.lanePushAt.get(cell), LANE_PUSH);
        reachLanePart(floodState, triggers.laneNearAt.get(cell), LANE_NEAR);
    }
    if (layer === WIZARD) reachLanePart(floodState, triggers.laneFromAt.get(cell), LANE_FROM);
}
// the first lane due after lane `after`, taken off the list; -1 when none. A lane that comes due in this pass at or
// before `after` waits for the next pass.
function nextLaneDue(floodState, after) {
    const lanesDue = floodState.lanesDue;
    let best = -1;
    for (let n = 0; n < lanesDue.length; n++)
        if (lanesDue[n] > after && (best < 0 || lanesDue[n] < lanesDue[best])) best = n;
    if (best < 0) return -1;
    const lane = lanesDue[best];
    lanesDue[best] = lanesDue[lanesDue.length - 1];
    lanesDue.pop();
    return lane;
}
// one pass in lane order: the cells a swap reaches can bring later lanes due within the pass
export function skipAndSwap(walkGrid, floodState) {
    const countLanesAt = (cell, layer) => countLanes(walkGrid, floodState, cell, layer);
    let more = false;
    for (let n = -1; ;) {
        visitReached(floodState, floodState.laneCursor, countLanesAt);
        n = nextLaneDue(floodState, n);
        if (n < 0) return more;
        const lane = walkGrid.lanes[n];
        if (floodState.pocket) {
            for (const c of [lane.pushCell, ...lane.cross])
                if (!blocked(walkGrid, floodState, c) && standable(walkGrid, floodState, c))
                    push(walkGrid, floodState, c, 0);
        } else {
            if (walkGrid.frozen.has(lane.stone)) continue;
            for (const c of lane.ride) push(walkGrid, floodState, c, WIZARD);
        }
        more = true;
    }
}
