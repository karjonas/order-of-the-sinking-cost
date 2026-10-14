// Gates and Switches: the latches that switch presses change, the moves that bring an object onto a Switch, and an
// OPEN beam bumping a Gate open (MOVEMENT.md "Gates, switches and buttons", "Promesst beams and powers")
import { latestFlag } from '../save.js';
import { addTo, cellOnSide, GATE, keyOf, PUSH, SOLID, SUPPORT, ZB } from './cells.js';
import { exists, place, put } from './groups.js';
import { waterAt } from './ocean.js';
import { requeue, visitReached } from './queue.js';
import { landingsOf, skipsOver } from './skipping-stones.js';
import { gateShutNow, holdsStone } from './support.js';
import { fenced, latestCell } from './walls.js';

// the moves that bring an object onto a Switch: the cells walked back from the Switch, and the highest fall
const PRESS_CELLS = 256,
    PRESS_FALL = 8,
    // the world.json movables kind of a Friendly_Dragon
    DRAGON_KIND = 4;

function latchOf(walkGrid, flavor) {
    const latch = walkGrid.latch;
    if (!latch.has(flavor)) latch.set(flavor, { open: [], shut: [] });
    return latch.get(flavor);
}
// A switch gate follows its flavor's existing Switches (all pressed, xor notted); a monster gate and a gate without
// switches keep their stored `open`. A shut Gate blocks its cell and holds up what stands on it (under water the hero
// stands at the surface). The flood opens a flavor's shut gates and shuts its notted ones once it can bring an object
// onto every Switch of the flavor not pressed.
export function placeGates(walkGrid) {
    const { world, latest, unpressed } = walkGrid;
    const pressed = new Map();
    for (const [pid, flavor, pressedByDefault, column, row, z, existence] of world.switches)
        if (exists(walkGrid, pid, existence)) {
            const on = latestFlag(latest, pid, 'pressed', pressedByDefault);
            addTo(pressed, flavor, on);
            if (!on) addTo(unpressed, flavor, keyOf(walkGrid, column, row, z));
        }
    for (const [pid, column, row, z, op, notted, flavor, monster, existence] of world.gates) {
        const ps = pressed.get(flavor),
            open = !monster && ps ? ps.every(Boolean) !== !!notted : latestFlag(latest, pid, 'open', op),
            cell = keyOf(walkGrid, column, row, z);
        if (cell < 0) continue;
        // a switch gate whose flavor has a Switch not pressed: an open one is notted, a shut one is not
        const latches = !monster && ps && unpressed.has(flavor);
        if (open) {
            if (!latches) continue;
            place(walkGrid, pid, existence, () => {
                if (!walkGrid.writeLog) latchOf(walkGrid, flavor).shut.push(cell);
            });
            continue;
        }
        place(walkGrid, pid, existence, () => {
            put(walkGrid, walkGrid.grid, cell, GATE | SUPPORT);
            if (walkGrid.writeLog) return;
            if (latches) latchOf(walkGrid, flavor).open.push(cell);
        });
    }
}
// A Friendly_Dragon presses no Switch.
export function placeNotPressers(walkGrid) {
    for (const [pid, column, row, z, kind, existence] of walkGrid.world.movables || [])
        if (kind === DRAGON_KIND && exists(walkGrid, pid, existence))
            walkGrid.notPressers.add(latestCell(walkGrid, pid, column, row, z));
}
// what an object cannot be pushed into: a solid voxel, a shut Gate, a closed ice gate
function walled(walkGrid, floodState, cell) {
    if ((walkGrid.grid[cell] & SOLID) !== 0) return true;
    return gateShutNow(walkGrid, floodState, cell) || walkGrid.frozen.has(cell);
}
// the skip onto cell `target` at height z of an object pushed `side` from cell `from` into water cell `first`
function skipFrom(walkGrid, floodState, target, z, side, from, first, way) {
    const pushCell = cellOnSide(walkGrid, from, (side + 2) % 4);
    if (walled(walkGrid, floodState, from) || !holdsStone(walkGrid, floodState, from, z)) return;
    if (fenced(walkGrid, pushCell, side, from)) return;
    // the stone is launched into `first`, which holds no stone
    if (holdsStone(walkGrid, floodState, first, z) || fenced(walkGrid, from, side, first)) return;
    if (landingsOf(walkGrid, floodState, side, first, z).includes(target)) way(from, pushCell, true);
}
// The moves that bring an object onto cell `target`: way(from, pushCell, skip) for each cell `from` an object is
// pushed from (the hero standing in pushCell) to end up in `target`. A push moves it one cell onto a cell that holds
// it, or off a ledge, and it falls through open air onto the first cell that does; a skipping stone pushed into level water skips
// on to a cell it can stop on (landingsOf, as in skipLanes). An object passes the Gates the flood has opened and not
// the ones a switch press has shut.
function movesOnto(walkGrid, floodState, target, way) {
    const { grid, layerCells, boxZ } = walkGrid;
    const z = Math.floor(target / layerCells) - ZB,
        column = target % layerCells,
        // per side, the cell an object is pushed from into `target` and the hero's push cell behind it; below the
        // fast-travel rooms the same cells m layers up are these plus m * layerCells
        fromCells = [],
        pushCells = [];
    for (let side = 0; side < 4; side++) {
        const back = (side + 2) % 4,
            from = cellOnSide(walkGrid, target, back);
        fromCells.push(from);
        pushCells.push(cellOnSide(walkGrid, from, back));
    }
    // pushes into cell a at height za, which the object then stands in or falls from onto p
    const pushesInto = (into, intoZ) => {
        const shift = into - target;
        for (let side = 0; side < 4; side++) {
            let from = fromCells[side] + shift,
                pushCell = pushCells[side] + shift;
            if (intoZ >= boxZ) {
                from = cellOnSide(walkGrid, into, (side + 2) % 4);
                pushCell = cellOnSide(walkGrid, from, (side + 2) % 4);
            }
            if (!holdsStone(walkGrid, floodState, from, intoZ) || walled(walkGrid, floodState, from)) continue;
            if (fenced(walkGrid, from, side, into) || fenced(walkGrid, pushCell, side, from)) continue;
            way(from, pushCell, false);
        }
    };
    pushesInto(target, z);
    for (let a = target + layerCells, za = z + 1; a < grid.length && za - z <= PRESS_FALL; a += layerCells, za++) {
        if (walled(walkGrid, floodState, a) || grid[a] & PUSH || holdsStone(walkGrid, floodState, a, za)) break;
        if (waterAt(walkGrid, column, za) != null) break;
        pushesInto(a, za);
    }
    for (let side = 0; side < 4; side++) {
        const back = (side + 2) % 4;
        let first = fromCells[side];
        if (fenced(walkGrid, first, side, target) || !skipsOver(walkGrid, floodState, first, z)) continue;
        let from = cellOnSide(walkGrid, first, back);
        for (let c = 0; c < walkGrid.width + walkGrid.height && skipsOver(walkGrid, floodState, from, z); c++) {
            // the Lily drifting through `from` holds a stone the hero can push off it too
            if (holdsStone(walkGrid, floodState, from, z))
                skipFrom(walkGrid, floodState, target, z, side, from, first, way);
            first = from;
            from = cellOnSide(walkGrid, from, back);
        }
        skipFrom(walkGrid, floodState, target, z, side, from, first, way);
    }
}
// a hero in an OPEN beam with no ALTER beam bumps the shut Gate next to it open, and it stays open
export function openGateAhead(walkGrid, floodState, cell, side, altered) {
    if (altered || !walkGrid.openBeamCells.has(cell)) return;
    const { grid } = walkGrid;
    const ahead = cellOnSide(walkGrid, cell, side);
    if (!(grid[ahead] & GATE) || grid[ahead] & SOLID || walkGrid.frozen.has(ahead)) return;
    if (!walkGrid.squeezeCells.has(cell) && fenced(walkGrid, cell, side, ahead)) return;
    floodState.opened.add(ahead);
}
// the cell of an object not in `taken` that the walk can bring onto the Switch cell (movesOnto, walked back from it
// over at most PRESS_CELLS cells, nearest first), pushing from cells it reached without a Wardrobe skill or that lie
// `outside` it (a way with a skip only carries a skipping stone), else -1. todo holds [cell, whether the way on from
// it skips] pairs.
function objectOnto(walkGrid, floodState, switchCell, taken) {
    const { grid, visited, notPressers, stoneCells } = walkGrid,
        outside = floodState.outside;
    const seen = new Set([switchCell * 2]),
        todo = [switchCell, 0];
    let found = -1;
    for (let n = 0; n < todo.length && n < 2 * PRESS_CELLS; n += 2) {
        const skipsLater = todo[n + 1];
        movesOnto(walkGrid, floodState, todo[n], (from, pushCell, skip) => {
            if (found >= 0 || !(visited[pushCell] & 1 || outside?.has(pushCell))) return;
            const skips = skipsLater || skip ? 1 : 0;
            if (grid[from] & PUSH) {
                const presses = !taken.has(from) && !notPressers.has(from);
                if (presses && (!skips || stoneCells.has(from))) found = from;
                return;
            }
            if (seen.has(from * 2 + skips)) return;
            seen.add(from * 2 + skips);
            todo.push(from, skips);
        });
        if (found >= 0) break;
    }
    return found;
}
// a walk that reaches every Switch of a flavor not pressed and can bring an object onto each, one object each, opens
// the flavor's shut gates and shuts its notted ones
function pressedAll(walkGrid, floodState, flavor) {
    if (floodState.latched.has(flavor)) return false;
    const switchCells = walkGrid.unpressed.get(flavor);
    if (!switchCells.every((c) => walkGrid.visited[c])) return false;
    const taken = new Set();
    for (const switchCell of switchCells) {
        const from = objectOnto(walkGrid, floodState, switchCell, taken);
        if (from < 0) return false;
        taken.add(from);
    }
    return true;
}
// per flavor (triggers.flavors), its Switch cells not pressed that the walk has not reached yet
function countSwitch(walkGrid, floodState, cell) {
    const flavors = walkGrid.triggers.switchesAt.get(cell);
    if (!flavors || floodState.switchesReached.has(cell)) return;
    floodState.switchesReached.add(cell);
    for (const n of flavors) floodState.switchesLeft[n]--;
}
export function press(walkGrid, floodState) {
    visitReached(floodState, floodState.pressCursor, (cell) => countSwitch(walkGrid, floodState, cell));
    let more = false;
    walkGrid.triggers.flavors.forEach(({ flavor, open, shut }, n) => {
        if (floodState.switchesLeft[n] > 0 || !pressedAll(walkGrid, floodState, flavor)) return;
        floodState.latched.add(flavor);
        for (const gateCell of open) {
            floodState.unlatched.add(gateCell);
            requeue(walkGrid, floodState, gateCell);
        }
        for (const gateCell of shut) {
            floodState.latchedShut.add(gateCell);
            requeue(walkGrid, floodState, gateCell + walkGrid.layerCells);
        }
        more = true;
    });
    return more;
}
