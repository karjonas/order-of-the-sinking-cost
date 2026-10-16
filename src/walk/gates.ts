// Gates and Switches: the latches that switch presses change, the moves that bring an object onto a Switch, and an
// OPEN beam bumping a Gate open (MOVEMENT.md "Gates, switches and buttons", "Promesst beams and powers")
import { latestFlag } from '../save.ts';
import { attackedAt } from './attacks.ts';
import { addTo, cellOnSide, GATE, neighbourOf, PUSH, SIDES, SOLID, SUPPORT, THRU, Z_BIAS } from './cells.ts';
import type { FloodState } from './flood.ts';
import { exists, place, put } from './groups.ts';
import { deep, levelWater, waterAt } from './ocean.ts';
import { push, requeue, settle, visitReached } from './queue.ts';
import { reachedEntries } from './room-answers.ts';
import { LAYER_COUNT } from './skills.ts';
import { landingsOf, skipsOver } from './skipping-stones.ts';
import { blocked, gateShutNow, holdsStone, standable } from './support.ts';
import type { WalkGrid } from './walker.ts';
import { fenced, latestCell } from './walls.ts';

// the moves that bring an object onto a Switch: the cells walked back from the Switch, and the highest fall
export const PRESS_CELLS = 2048;
export const PRESS_FALL = 8;

// the ways on from a cell of a walk back: it skips, and a skip on it is a stone a hero with CHARM launches
const SKIPS = 1;
const CHARMED = 2;

// the world.json movables kind of a Friendly_Dragon
const DRAGON_KIND = 4;

// the world.gates `closes` of a Gate that pushes what stands in it up as it closes
const CLOSES_UP = 4;

/** The cells a flavor's presses change: its shut switch gates to open, and its open notted gates to shut. */
export interface Latch {
    open: number[];
    shut: number[];
}

/**
 * A shut switch gate that closes upward, beside a Switch of its flavor not pressed: a hero on the Switch, with an
 * object on every other Switch of the flavor, holds the Gate open; stepping off the Switch into it (on side `side`)
 * releases the Switch, and the closing Gate lifts him onto the cell above.
 */
export interface GateLift {
    flavor: number;
    switchCell: number;
    side: number;
    gateCell: number;
}

/**
 * A move that brings an object onto a cell: pushed from `from` by the hero in `pushCell`, whether it skips, and
 * whether it is a skip launched by a hero with CHARM, who stands in `pushCell` and steps on beside the stone.
 */
type PushWay = (from: number, pushCell: number, skip: boolean, charmed: boolean) => void;

// how far from a stone a hero with CHARM charms it, in cells along each axis
const CHARM_RANGE = 2;

/**
 * A flavor whose press failed: what the search saw (pressInputs), the push cells it turned down because the walk had
 * not reached them and the solid cells that stopped a skip (`wallStops`). The same search finds nothing new until one
 * of those changes.
 */
export interface PressMiss {
    inputs: number;
    pushCells: number[];
    wallStops: number[];
}

/** The latch of a flavor, made when it has none yet. */
function latchOf(walkGrid: WalkGrid, flavor: number): Latch {
    let latch = walkGrid.latch.get(flavor);
    if (!latch) {
        latch = { open: [], shut: [] };
        walkGrid.latch.set(flavor, latch);
    }

    return latch;
}

/**
 * Places the Gates and Switches. A switch gate follows its flavor's existing Switches (all pressed, xor notted); a
 * monster gate and a gate without switches keep their stored `open`. A shut Gate blocks its cell and holds up what
 * stands on it (under water the hero stands at the surface). The flood opens a flavor's shut gates and shuts its
 * notted ones once it can bring an object onto every Switch of the flavor not pressed.
 */
export function placeGates(walkGrid: WalkGrid): void {
    const { world, geometry, latest, unpressed } = walkGrid;
    const pressedByFlavor = new Map<number, boolean[]>();

    for (let switchIndex = 0; switchIndex < world.switches.length; switchIndex++) {
        const [pid, flavor, pressedByDefault, , , , existence] = world.switches[switchIndex];
        if (!exists(walkGrid, pid, existence)) continue;
        const pressed = latestFlag(latest, pid, 'pressed', pressedByDefault);
        addTo(pressedByFlavor, flavor, pressed);
        if (!pressed) addTo(unpressed, flavor, geometry.switchCells[switchIndex]);
    }

    for (let gateIndex = 0; gateIndex < world.gates.length; gateIndex++) {
        const [pid, , , , openByDefault, notted, flavor, monster, closes, existence] = world.gates[gateIndex];
        const switchesPressed = pressedByFlavor.get(flavor);
        const followsSwitches = !monster && switchesPressed !== undefined;

        let open = false;
        if (followsSwitches) {
            const allPressed = switchesPressed.every((pressed) => pressed);
            open = allPressed !== !!notted;
        } else {
            open = latestFlag(latest, pid, 'open', openByDefault);
        }

        const cell = geometry.gateCells[gateIndex];
        if (cell < 0) continue;

        // a switch gate whose flavor has a Switch not pressed: an open one is notted, a shut one is not
        const latches = followsSwitches && unpressed.has(flavor);

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

            // a shut monster Gate opens once no living Monster stands in its room; a notted one shuts instead
            if (monster && !notted) walkGrid.monsterGateCells.push(cell);
            if (!latches) return;

            latchOf(walkGrid, flavor).open.push(cell);
            if (closes === CLOSES_UP) placeLifts(walkGrid, flavor, cell);
        });
    }
}

/** Notes the lifts of a shut switch gate that closes upward: one per Switch of its flavor not pressed beside it. */
function placeLifts(walkGrid: WalkGrid, flavor: number, gateCell: number): void {
    for (const switchCell of walkGrid.unpressed.get(flavor) ?? []) {
        for (const side of SIDES) {
            if (cellOnSide(walkGrid, switchCell, side) === gateCell) {
                walkGrid.gateLifts.push({ flavor, switchCell, side, gateCell });
            }
        }
    }
}

/** Notes the cells of the objects that press no Switch: a Friendly_Dragon. */
export function placeNotPressers(walkGrid: WalkGrid): void {
    for (const [pid, column, row, z, kind, existence] of walkGrid.world.movables || []) {
        if (kind === DRAGON_KIND && exists(walkGrid, pid, existence)) {
            walkGrid.notPressers.add(latestCell(walkGrid, pid, column, row, z));
        }
    }
}

/** What an object cannot be pushed into: a solid voxel, a shut Gate, a closed Freezer. */
export function walled(walkGrid: WalkGrid, floodState: FloodState, cell: number): boolean {
    if ((walkGrid.grid[cell] & SOLID) !== 0) return true;
    return gateShutNow(walkGrid, floodState, cell) || walkGrid.frozen.has(cell);
}

/**
 * Calls way(from, bardCell, true, true) for each cell a hero with CHARM can launch the stone in `from` from, `side`
 * into water (SKILLS.md "CHARM"): a cell standable within CHARM_RANGE of the stone in each direction, one layer up or
 * down included, from which his step on `side` is open, since a charm move pushes nothing. The step may go to the
 * stone's own cell, which the stone leaves.
 */
function charmLaunches(walkGrid: WalkGrid, floodState: FloodState, from: number, side: number, way: PushWay): void {
    const { grid, layerCells, boxZ } = walkGrid;
    const fromZ = Math.floor(from / layerCells) - Z_BIAS;
    if (fromZ >= boxZ) return;

    for (let layerStep = -CHARM_RANGE; layerStep <= CHARM_RANGE; layerStep++) {
        const layerShift = layerStep * layerCells;

        for (let dy = -CHARM_RANGE; dy <= CHARM_RANGE; dy++) {
            for (let dx = -CHARM_RANGE; dx <= CHARM_RANGE; dx++) {
                const bardCell = neighbourOf(walkGrid, from, dx, dy) + layerShift;
                if (bardCell === from || bardCell < 0 || bardCell >= grid.length) continue;
                if (!standable(walkGrid, floodState, bardCell)) continue;

                const stepCell = cellOnSide(walkGrid, bardCell, side);
                if (fenced(walkGrid, bardCell, side, stepCell)) continue;
                if (stepCell !== from && (grid[stepCell] & PUSH || !standable(walkGrid, floodState, stepCell)))
                    continue;

                way(from, bardCell, true, true);
            }
        }
    }
}

/**
 * Notes the Freezer that holds the MIRRORABLE stone in `from`, when a hero with CHARM would launch it from there: the
 * flood's stoneFront, the Freezers whose opening may let the walk press a Switch.
 */
function noteFrozenStone(walkGrid: WalkGrid, floodState: FloodState, from: number, charm: boolean): void {
    if (!charm || !floodState.stoneFront || !walkGrid.charmStones.has(from)) return;

    const freezerIndex = walkGrid.frozen.get(from);
    if (freezerIndex !== undefined) floodState.stoneFront.add(freezerIndex);
}

/**
 * The skip onto cell `target` at height z of an object pushed `side` from cell `from` into water cell `firstWater`,
 * and with `charm` of a stone a hero with CHARM launches from there. The solid cells that stop the skip go to
 * `wallStops`.
 */
function skipFrom(
    walkGrid: WalkGrid,
    floodState: FloodState,
    target: number,
    z: number,
    side: number,
    from: number,
    firstWater: number,
    way: PushWay,
    wallStops: number[],
    charm: boolean,
): void {
    const pushCell = cellOnSide(walkGrid, from, (side + 2) % 4);

    if (walled(walkGrid, floodState, from)) {
        noteFrozenStone(walkGrid, floodState, from, charm);
        return;
    }

    if (!holdsStone(walkGrid, floodState, from, z)) return;

    const charmed = charm && walkGrid.charmPlaces.has(from);
    const pushFenced = fenced(walkGrid, pushCell, side, from);
    if (pushFenced && !charmed) return;

    // the stone is launched into `firstWater`, which holds no stone
    if (holdsStone(walkGrid, floodState, firstWater, z) || fenced(walkGrid, from, side, firstWater)) return;

    const landings = landingsOf(walkGrid, floodState, side, firstWater, z, wallStops);
    if (!landings.includes(target)) return;

    if (!pushFenced) way(from, pushCell, true, false);
    if (charmed) charmLaunches(walkGrid, floodState, from, side, way);
}

/**
 * The skips onto cell `target` of a skipping stone pushed into level water on side `side` of it: the stone is
 * launched from each cell it can stand on further back along the water. The solid cells that stop a skip go to
 * `wallStops`.
 */
function skipsOnto(
    walkGrid: WalkGrid,
    floodState: FloodState,
    target: number,
    side: number,
    way: PushWay,
    wallStops: number[],
    charm: boolean,
): void {
    const z = Math.floor(target / walkGrid.layerCells) - Z_BIAS;
    const back = (side + 2) % 4;
    let firstWater = cellOnSide(walkGrid, target, back);
    if (fenced(walkGrid, firstWater, side, target) || !skipsOver(walkGrid, floodState, firstWater, z)) return;

    let from = cellOnSide(walkGrid, firstWater, back);

    for (let stepsBack = 0; stepsBack < walkGrid.width + walkGrid.height; stepsBack++) {
        if (!skipsOver(walkGrid, floodState, from, z)) break;

        // the Lily drifting through `from` holds a stone the hero can push off it too
        if (holdsStone(walkGrid, floodState, from, z)) {
            skipFrom(walkGrid, floodState, target, z, side, from, firstWater, way, wallStops, charm);
        }

        firstWater = from;
        from = cellOnSide(walkGrid, from, back);
    }

    skipFrom(walkGrid, floodState, target, z, side, from, firstWater, way, wallStops, charm);
}

/**
 * The moves that bring an object onto cell `target`: way(from, pushCell, skip, charmed) for each cell `from` an object
 * is pushed from (the hero standing in pushCell) to end up in `target`. A push moves it one cell onto a cell that holds
 * it, or off a ledge, and it falls through open air onto the first cell that does; a skipping stone pushed into level
 * water skips on to a cell it can stop on (landingsOf, as in skipLanes), and with `charm` a hero with CHARM launches
 * the stone in a place of charmStones the same way. An object passes the Gates the flood has opened and not the ones
 * a switch press has shut. The solid cells that stop a skip go to `wallStops`.
 */
function movesOnto(
    walkGrid: WalkGrid,
    floodState: FloodState,
    target: number,
    wallStops: number[],
    way: PushWay,
    charm: boolean,
): void {
    const { grid, layerCells, boxZ } = walkGrid;
    const z = Math.floor(target / layerCells) - Z_BIAS;
    const column = target % layerCells;

    // per side, the cell an object is pushed from into `target` and the hero's push cell behind it; below the
    // fast-travel rooms the same cells m layers up are these plus m * layerCells
    const fromCells: number[] = [];
    const pushCells: number[] = [];

    for (let side = 0; side < 4; side++) {
        const back = (side + 2) % 4;
        const from = cellOnSide(walkGrid, target, back);
        fromCells.push(from);
        pushCells.push(cellOnSide(walkGrid, from, back));
    }

    // the pushes into cell `into` at height intoZ, which the object then stands in or falls from onto `target`
    const pushesInto = (into: number, intoZ: number): void => {
        const shift = into - target;

        for (let side = 0; side < 4; side++) {
            const back = (side + 2) % 4;
            let from = fromCells[side] + shift;
            let pushCell = pushCells[side] + shift;

            if (intoZ >= boxZ) {
                from = cellOnSide(walkGrid, into, back);
                pushCell = cellOnSide(walkGrid, from, back);
            }

            if (!holdsStone(walkGrid, floodState, from, intoZ) || walled(walkGrid, floodState, from)) continue;
            if (fenced(walkGrid, from, side, into) || fenced(walkGrid, pushCell, side, from)) continue;
            way(from, pushCell, false, false);
        }
    };

    pushesInto(target, z);

    // an object that falls into water sinks to the surface - 1, so it falls through water only onto a target one
    // below the surface of the water over it
    let sinkSurface: number | null = null;
    if (levelWater(walkGrid, target + layerCells, z + 1)) sinkSurface = waterAt(walkGrid, column, z + 1);

    let into = target + layerCells;

    for (let intoZ = z + 1; into < grid.length && intoZ - z <= PRESS_FALL; intoZ++) {
        if (walled(walkGrid, floodState, into) || grid[into] & PUSH) break;
        if (holdsStone(walkGrid, floodState, into, intoZ)) break;

        const surface = waterAt(walkGrid, column, intoZ);
        if (surface != null && surface !== sinkSurface) break;

        pushesInto(into, intoZ);
        into += layerCells;
    }

    for (let side = 0; side < 4; side++) skipsOnto(walkGrid, floodState, target, side, way, wallStops, charm);
}

/** A hero in an OPEN beam with no ALTER beam bumps the shut Gate next to it open, and it stays open. */
export function openGateAhead(
    walkGrid: WalkGrid,
    floodState: FloodState,
    cell: number,
    side: number,
    altered: boolean,
): void {
    if (altered || !walkGrid.openBeamCells.has(cell)) return;

    const grid = walkGrid.grid;
    const ahead = cellOnSide(walkGrid, cell, side);
    if (!(grid[ahead] & GATE) || grid[ahead] & SOLID || walkGrid.frozen.has(ahead)) return;
    if (!walkGrid.squeezeCells.has(cell) && fenced(walkGrid, cell, side, ahead)) return;

    floodState.opened.add(ahead);
}

/**
 * What a walk back from a target cell asks of the object and of the pushes. `heroPushes`: whether the hero pushes from
 * a cell. `accepts`: whether the pushable in `from` is an object the walk is after, given whether the way on from it
 * skips and whether a skip on the way is a stone a hero with CHARM launches; any other pushable ends its branch.
 * `stays`: whether an object may be pushed through the cell `from` (all cells when left out). `charms`: whether a hero
 * with CHARM launches skipping stones (left out: none). A push from an attacked cell is never made: the hero steps into
 * it and dies.
 */
export interface WalkBackRule {
    heroPushes: (pushCell: number) => boolean;
    accepts: (from: number, skips: boolean, charmed: boolean) => boolean;
    stays?: (from: number) => boolean;
    charms?: boolean;
}

/**
 * The cell of an object that a hero with TELEPORT swaps onto `target`, else -1: he stands in `target` in walk layer 2
 * (noteSwap), it holds no object but holds a pushed one up, and the object is one `rule` accepts and the flood has not
 * moved off its cell. The swap puts the object where he stood, so it needs no push cell.
 */
function swappedOnto(walkGrid: WalkGrid, floodState: FloodState, target: number, rule: WalkBackRule): number {
    const objectCells = floodState.swapsAt.get(target);
    if (!objectCells) return -1;

    const z = Math.floor(target / walkGrid.layerCells) - Z_BIAS;
    if (walkGrid.grid[target] & PUSH || !holdsStone(walkGrid, floodState, target, z)) return -1;
    if (rule.stays && !rule.stays(target)) return -1;

    for (const objectCell of objectCells) {
        if (!(walkGrid.grid[objectCell] & PUSH)) continue;
        if (rule.accepts(objectCell, false, false)) return objectCell;
    }

    return -1;
}

/**
 * The cell of an object that the walk can bring onto `target` (movesOnto, walked back from it over at most PRESS_CELLS
 * cells, nearest first) by the pushes `rule` allows, else the cell of an object a TELEPORT swap brings onto it
 * (swappedOnto), else -1. The push cells turned down and the solid cells that stopped a skip go to `miss`.
 */
export function bringObjectOnto(
    walkGrid: WalkGrid,
    floodState: FloodState,
    target: number,
    miss: PressMiss,
    rule: WalkBackRule,
): number {
    const grid = walkGrid.grid;
    const { heroPushes, accepts, stays, charms = false } = rule;

    // [cell, the way on from it] pairs, the way being SKIPS when it skips and CHARMED when a skip on it is a stone a
    // hero with CHARM launches; `seen` keys them as cell * 4 + way
    const todo = [target, 0];
    const seen = new Set([target * 4]);
    let found = -1;

    for (let pairStart = 0; pairStart < todo.length && pairStart < 2 * PRESS_CELLS; pairStart += 2) {
        const wayLater = todo[pairStart + 1];

        const visitWay: PushWay = (from, pushCell, skip, charmed) => {
            if (found >= 0) return;
            if (!charmed && attackedAt(walkGrid, from)) return;

            if (!heroPushes(pushCell)) {
                miss.pushCells.push(pushCell);
                return;
            }

            if (stays && !stays(from)) return;

            let way = wayLater;
            if (skip) way |= SKIPS;
            if (charmed) way |= CHARMED;

            if (grid[from] & PUSH) {
                if (accepts(from, (way & SKIPS) !== 0, (way & CHARMED) !== 0)) found = from;
                return;
            }

            const key = from * 4 + way;
            if (seen.has(key)) return;
            seen.add(key);
            todo.push(from, way);
        };

        movesOnto(walkGrid, floodState, todo[pairStart], miss.wallStops, visitWay, charms);

        if (found >= 0) break;
    }

    if (found < 0) found = swappedOnto(walkGrid, floodState, target, rule);

    return found;
}

/**
 * The cell of an object not in `taken`, and not one that presses another flavor's Switch, that the stored answer of the
 * Switch's room (room-answers.ts) has stand on the Switch cell, from a start the walk has reached, else -1. The start
 * cells not reached go to `miss`.
 */
function storedObjectOnto(
    walkGrid: WalkGrid,
    floodState: FloodState,
    switchCell: number,
    taken: Set<number>,
    miss: PressMiss,
): number {
    const entries = walkGrid.rooms.byCell.get(switchCell);
    if (!entries) return -1;

    const { grid, notPressers } = walkGrid;

    for (const entry of reachedEntries(walkGrid, floodState.outside, entries, miss.pushCells)) {
        for (const objectCell of entry.holders.get(switchCell) ?? []) {
            if (!(grid[objectCell] & PUSH)) continue;
            if (taken.has(objectCell) || floodState.pressing.has(objectCell) || notPressers.has(objectCell)) continue;
            return objectCell;
        }
    }

    return -1;
}

/**
 * The cell of an object not in `taken`, and not one that presses another flavor's Switch, that the walk can bring onto
 * the Switch cell: the stored answer of its room has it stand there, or the walk back from the Switch finds it,
 * pushing from cells it reached without a Wardrobe skill or that lie `outside` it (a way with a skip only carries a
 * skipping stone). Else -1.
 */
function objectOnto(
    walkGrid: WalkGrid,
    floodState: FloodState,
    switchCell: number,
    taken: Set<number>,
    miss: PressMiss,
): number {
    const stored = storedObjectOnto(walkGrid, floodState, switchCell, taken, miss);
    if (stored >= 0) return stored;

    const { visited, notPressers, stoneCells, charmStones } = walkGrid;
    const outside = floodState.outside;

    return bringObjectOnto(walkGrid, floodState, switchCell, miss, {
        heroPushes: (pushCell) => (visited[pushCell] & 1) !== 0 || outside?.has(pushCell) === true,
        accepts: (from, skips, charmed) => {
            const presses = !taken.has(from) && !floodState.pressing.has(from) && !notPressers.has(from);
            const skipped = !skips || stoneCells.has(from);
            return presses && skipped && (!charmed || charmStones.has(from));
        },
        charms: floodState.charming,
    });
}

/**
 * The cells of the objects, one each, that a walk brings onto the Switches of a flavor not pressed, when it reaches every
 * one of them and can bring an object onto each, which opens the flavor's shut gates and shuts its notted ones; else
 * null. What its searches turned down goes to `miss`.
 */
function pressingObjects(
    walkGrid: WalkGrid,
    floodState: FloodState,
    flavor: number,
    miss: PressMiss,
): Set<number> | null {
    if (floodState.latched.has(flavor)) return null;
    const switchCells = walkGrid.unpressed.get(flavor) ?? [];
    if (!switchCells.every((cell) => switchReached(walkGrid, cell))) return null;
    return objectsOntoAll(walkGrid, floodState, switchCells, miss);
}

/**
 * Whether the walk has reached the Switch cell `cell`, or needs not: no hero reaches a Switch under water, nor one on
 * an islet a charmed stone lands on, so only the search for an object onto it decides.
 */
function switchReached(walkGrid: WalkGrid, cell: number): boolean {
    return walkGrid.visited[cell] !== 0 || deep(walkGrid, cell) || walkGrid.charmIslets.has(cell);
}

/** The cells of the separate objects the walk can bring onto each of the Switch cells `switchCells`, else null. */
function objectsOntoAll(
    walkGrid: WalkGrid,
    floodState: FloodState,
    switchCells: number[],
    miss: PressMiss,
): Set<number> | null {
    const taken = new Set<number>();

    for (const switchCell of switchCells) {
        const from = objectOnto(walkGrid, floodState, switchCell, taken, miss);
        if (from < 0) return null;
        taken.add(from);
    }

    return taken;
}

/**
 * Whether the hero on Switch `switchCell` holds its flavor down alone: the walk has reached every other Switch of the
 * flavor not pressed and can bring an object onto each of those. A search that found no object is kept in
 * misses[index] and looked at again only once what it reads has changed.
 */
function heldAlone(
    walkGrid: WalkGrid,
    floodState: FloodState,
    flavor: number,
    switchCell: number,
    misses: Array<PressMiss | undefined>,
    index: number,
): boolean {
    const otherSwitches = (walkGrid.unpressed.get(flavor) ?? []).filter((cell) => cell !== switchCell);
    if (!otherSwitches.every((cell) => switchReached(walkGrid, cell))) return false;

    const miss = misses[index];
    if (miss && !missChanged(walkGrid, floodState, miss)) return false;

    const newMiss: PressMiss = { inputs: pressInputs(floodState), pushCells: [], wallStops: [] };
    if (objectsOntoAll(walkGrid, floodState, otherSwitches, newMiss) === null) {
        misses[index] = newMiss;
        return false;
    }

    return true;
}

/**
 * Lifts the hero onto the cell above each Gate of a GateLift: once the walk has reached its Switch and he holds it
 * down alone (heldAlone), he steps off the Switch into the Gate, which closes under him. Not when a Fence parts the
 * Switch from the Gate, the Gate is frozen in a closed Freezer or the cell above is blocked. Returns whether any lift
 * added cells.
 */
function lift(walkGrid: WalkGrid, floodState: FloodState): boolean {
    const { visited, layerCells, grid } = walkGrid;
    const lifts = walkGrid.triggers.lifts;
    let more = false;

    for (let liftIndex = 0; liftIndex < lifts.length; liftIndex++) {
        if (floodState.liftsDone[liftIndex]) continue;
        const { flavor, switchCell, side, gateCell } = lifts[liftIndex];
        if (!floodState.switchesReached.has(switchCell)) continue;
        if (walkGrid.frozen.has(gateCell) || grid[gateCell] & (SOLID | PUSH)) continue;
        if (fenced(walkGrid, switchCell, side, gateCell)) continue;

        const above = gateCell + layerCells;
        if (above >= grid.length || blocked(walkGrid, floodState, above)) continue;
        if (!heldAlone(walkGrid, floodState, flavor, switchCell, floodState.liftMisses, liftIndex)) continue;

        floodState.liftsDone[liftIndex] = 1;

        // the closed Gate holds him up, so he stays in the cell above whatever the flood makes of the Gate
        for (let layer = 0; layer < LAYER_COUNT; layer++) {
            if (visited[switchCell] & (1 << layer)) push(walkGrid, floodState, above, layer);
        }

        more = true;
    }

    return more;
}

/**
 * Hops the hero off the Switch of each SwitchHop by its magic Mirror: once the walk has reached the Switch and he holds
 * it down alone (heldAlone), the Mirror's rays see the flavor's gates as pressed. He lands with the Switch released, so
 * the landing must not be blocked as the flood stands, and the walk goes on from it in the layers it reached the
 * Switch in. Returns whether any hop added cells.
 */
function hopOffSwitches(walkGrid: WalkGrid, floodState: FloodState): boolean {
    const { visited, layerCells } = walkGrid;
    const hops = walkGrid.triggers.hops;
    let more = false;

    for (let hopIndex = 0; hopIndex < hops.length; hopIndex++) {
        if (floodState.hopsDone[hopIndex]) continue;
        const { flavor, switchCell, landing } = hops[hopIndex];
        if (!floodState.switchesReached.has(switchCell)) continue;
        if (blocked(walkGrid, floodState, landing)) continue;
        if (!heldAlone(walkGrid, floodState, flavor, switchCell, floodState.hopMisses, hopIndex)) continue;

        floodState.hopsDone[hopIndex] = 1;
        const z = Math.floor(switchCell / layerCells) - Z_BIAS;

        for (let layer = 0; layer < LAYER_COUNT; layer++) {
            if (visited[switchCell] & (1 << layer)) settle(walkGrid, floodState, landing, z, layer);
        }

        more = true;
    }

    return more;
}

/**
 * A count that grows whenever the flood changes something the press search reads besides the reached cells and the
 * walls a THROUGH beam lets the hero into: the Gates it opened or shut, the objects its pushes moved, the hero taking
 * CHARM, the crystals a TRANSMUTE hero made, the water cells it bridged, which then hold pushed objects, and the
 * swaps it noted onto a Switch or a Gem_Slot.
 */
export function pressInputs(floodState: FloodState): number {
    const inputs =
        floodState.opened.size +
        floodState.unlatched.size +
        floodState.latchedShut.size +
        floodState.transmuted.size +
        floodState.bridged.size +
        floodState.ontoSwaps +
        Number(floodState.charming);

    const beamFlood = floodState.beamFlood;
    if (!beamFlood) return inputs;
    return inputs + beamFlood.gemsMoved.size + beamFlood.rockPushes;
}

/**
 * Whether a failed press may go another way now: what the search reads has changed, a push cell it turned down is
 * reached, or a THROUGH beam now runs through a solid cell that stopped one of its skips. Within a flood the reached
 * cells and the THROUGH beams only grow. `extraInputs`: what the search reads besides pressInputs, counted as the
 * search made the miss.
 */
export function missChanged(walkGrid: WalkGrid, floodState: FloodState, miss: PressMiss, extraInputs = 0): boolean {
    if (miss.inputs !== pressInputs(floodState) + extraInputs) return true;
    if (miss.pushCells.some((cell) => (walkGrid.visited[cell] & 1) !== 0)) return true;
    return miss.wallStops.some((cell) => (walkGrid.cellFlags[cell] & THRU) !== 0);
}

/** Counts a reached Switch cell off its flavors' Switches not pressed that the walk has not reached yet. */
function countSwitch(walkGrid: WalkGrid, floodState: FloodState, cell: number): void {
    const flavors = walkGrid.triggers.switchesAt.get(cell);
    if (!flavors || floodState.switchesReached.has(cell)) return;
    floodState.switchesReached.add(cell);

    for (const flavorIndex of flavors) floodState.switchesLeft[flavorIndex]--;
}

/**
 * First the magic-mirror hops off a Switch the hero holds down (SwitchHop); while they add cells, nothing else. Then
 * presses the flavors whose Switches the walk has all reached and can bring an object onto, in latch order: their
 * shut gates open and their notted gates shut, and the walk goes on from next to them. A flavor that failed is looked
 * at again only once what its search reads has changed (PressMiss). Then the lifts of the closing Gates (GateLift).
 * Returns whether any hop added cells or any flavor was pressed or any lift added cells.
 */
export function press(walkGrid: WalkGrid, floodState: FloodState): boolean {
    visitReached(floodState, floodState.pressCursor, (cell) => countSwitch(walkGrid, floodState, cell));

    // a hop off a held Switch lands with the Switch released, so the walk goes on from the landing before any press
    // changes the Gates of the flavor for the rest of the flood
    const hopped = walkGrid.triggers.hops.length > 0 && hopOffSwitches(walkGrid, floodState);
    if (hopped && floodState.queue.length) return true;

    const flavors = walkGrid.triggers.flavors;
    const misses = floodState.pressMisses;
    let more = false;

    for (let flavorIndex = 0; flavorIndex < flavors.length; flavorIndex++) {
        const { flavor, open, shut } = flavors[flavorIndex];
        if (floodState.switchesLeft[flavorIndex] > 0) continue;
        const miss = misses[flavorIndex];
        if (miss && !missChanged(walkGrid, floodState, miss)) continue;

        const newMiss: PressMiss = { inputs: pressInputs(floodState), pushCells: [], wallStops: [] };
        const objects = pressingObjects(walkGrid, floodState, flavor, newMiss);
        if (objects === null) {
            misses[flavorIndex] = newMiss;
            continue;
        }

        floodState.latched.add(flavor);
        for (const objectCell of objects) floodState.pressing.add(objectCell);

        for (const gateCell of open) {
            floodState.unlatched.add(gateCell);
            requeue(walkGrid, floodState, gateCell);
        }

        for (const gateCell of shut) {
            floodState.latchedShut.add(gateCell);
            requeue(walkGrid, floodState, gateCell + walkGrid.layerCells);
        }

        more = true;
    }

    if (walkGrid.triggers.lifts.length && lift(walkGrid, floodState)) more = true;

    return more;
}
