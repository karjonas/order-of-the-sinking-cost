// Rocks and spare Gems pushed into water with turns: a Rock or Gem the walk can push to a cell where it sinks makes the
// water cell a bridge (MOVEMENT.md "Objects in water", VIEWER.md "Moves")
import { BRIDGE_MARK, cellOnSide, PUSH, Z_BIAS } from './cells.ts';
import type { FloodState } from './flood.ts';
import { missChanged, PRESS_CELLS, PRESS_FALL, pressInputs, walled } from './gates.ts';
import type { PressMiss } from './gates.ts';
import { levelWater, waterAt } from './ocean.ts';
import { requeue, visitReached } from './queue.ts';
import { holdsStone, standable } from './support.ts';
import { swappedTo, visitSwaps } from './swaps.ts';
import type { WalkGrid } from './walker.ts';
import { fenced } from './walls.ts';

/**
 * An existing Rock that is no skipping stone: its pid and the cell the save last left it in. A Tree a TRANSMUTE hero
 * turns into a crystal is one once its transmute target `target` is turned.
 */
export interface RockTurn {
    pid: number;
    cell: number;
    target?: number;
}

/** Where a push ends: the cell the object lands in, and whether it sinks in water level with that cell. */
export interface Landing {
    cell: number;
    sinks: boolean;
}

/** The Rocks whose pushes may turn: the existing ones that are no skipping stone, in the order of the level data. */
export function rockTurnsOf(walkGrid: WalkGrid): RockTurn[] {
    const skippable = new Set(walkGrid.world.skippable || []);
    return walkGrid.rocks.filter(({ pid }) => !skippable.has(pid));
}

/**
 * Whether the surfaces of the cells a Rock fell through are open to a fall onto a cell whose water surface is
 * `sinkSurface` (null: no water level with it): each is dry or the same surface, as movesOnto reads the cells over its
 * target.
 */
function fallsThroughSurfaces(surfaces: Array<number | null>, sinkSurface: number | null): boolean {
    for (const surface of surfaces) {
        if (surface != null && surface !== sinkSurface) return false;
    }

    return true;
}

/**
 * Where a Rock in `from` ends when pushed on side `side`, as movesOnto reads it from the other end: it enters the next
 * cell and lands there if the cell holds it, else falls through open air and water at most PRESS_FALL cells onto the
 * first cell that holds it, or sinks in the first cell of water level with its height, where it becomes a bridge.
 * null where the push fails or the Rock never lands.
 */
function landingOf(walkGrid: WalkGrid, floodState: FloodState, from: number, side: number): Landing | null {
    const { grid, layerCells } = walkGrid;
    const fromZ = Math.floor(from / layerCells) - Z_BIAS;
    let cell = cellOnSide(walkGrid, from, side);
    const column = cell % layerCells;
    const surfaces: Array<number | null> = [];

    for (let fallen = 0; fallen <= PRESS_FALL && cell >= layerCells; fallen++) {
        const z = fromZ - fallen;
        if (walled(walkGrid, floodState, cell) || grid[cell] & PUSH) return null;

        if (holdsStone(walkGrid, floodState, cell, z)) {
            let sinkSurface: number | null = null;
            if (fallen > 0 && levelWater(walkGrid, cell + layerCells, z + 1)) {
                sinkSurface = waterAt(walkGrid, column, z + 1);
            }

            if (!fallsThroughSurfaces(surfaces, sinkSurface)) return null;
            return { cell, sinks: false };
        }

        const surface = waterAt(walkGrid, column, z);

        if (levelWater(walkGrid, cell, z) && fallen < PRESS_FALL) {
            if (!fallsThroughSurfaces(surfaces, surface)) return null;
            return { cell, sinks: true };
        }

        surfaces.push(surface);
        cell -= layerCells;
    }

    return null;
}

/**
 * Calls visit(landing) for each push of the object in `from` that the hero can make from a cell the flood reached in
 * layer 0, as a Rock lands in landingOf. None when the object cannot stand in `from`. The push cells turned down because
 * the flood has not reached them go to `miss`.
 */
export function pushLandings(
    walkGrid: WalkGrid,
    floodState: FloodState,
    from: number,
    miss: PressMiss,
    visit: (landing: Landing) => void,
): void {
    const { layerCells, visited } = walkGrid;
    const z = Math.floor(from / layerCells) - Z_BIAS;
    if (walled(walkGrid, floodState, from) || !holdsStone(walkGrid, floodState, from, z)) return;

    for (let side = 0; side < 4; side++) {
        const pushCell = cellOnSide(walkGrid, from, (side + 2) % 4);
        const into = cellOnSide(walkGrid, from, side);
        if (fenced(walkGrid, from, side, into) || fenced(walkGrid, pushCell, side, from)) continue;

        const landing = landingOf(walkGrid, floodState, from, side);
        if (!landing) continue;

        if ((visited[pushCell] & 1) === 0) {
            miss.pushCells.push(pushCell);
            continue;
        }

        visit(landing);
    }
}

/**
 * Whether a bridge in `waterCell` joins ground the flood reached to ground it has not: it holds no hero yet, a cell
 * beside it is reached and another beside it is a cell a hero stands in that is not. The cells beside it go to
 * `miss`, since reaching one may make it join them.
 */
export function joinsNewGround(
    walkGrid: WalkGrid,
    floodState: FloodState,
    waterCell: number,
    miss: PressMiss,
): boolean {
    if (standable(walkGrid, floodState, waterCell)) return false;

    const { visited } = walkGrid;
    let joinsReached = false;
    let joinsNew = false;

    for (let side = 0; side < 4; side++) {
        const beside = cellOnSide(walkGrid, waterCell, side);
        miss.pushCells.push(beside);

        if (visited[beside] !== 0) {
            joinsReached = true;
        } else if (standable(walkGrid, floodState, beside) && !floodState.outside?.has(beside)) {
            joinsNew = true;
        }
    }

    return joinsReached && joinsNew;
}

/**
 * The first water cell `accepts` where the Rock in `rockCell` sinks, else -1: the cells the Rock is pushed to from its
 * own cell or a cell a swap put it in, nearest first over at most PRESS_CELLS cells, by a hero who stands in a cell the
 * flood reached. The push cells turned down go to `miss`.
 */
export function sinkOf(
    walkGrid: WalkGrid,
    floodState: FloodState,
    rockCell: number,
    miss: PressMiss,
    accepts: (waterCell: number) => boolean,
): number {
    const positions = [rockCell];
    for (const swapped of swappedTo(floodState, rockCell)) {
        if (!(walkGrid.grid[swapped] & PUSH)) positions.push(swapped);
    }

    const seen = new Set(positions);
    let waterCell = -1;

    for (let index = 0; index < positions.length && index < PRESS_CELLS; index++) {
        pushLandings(walkGrid, floodState, positions[index], miss, (landing) => {
            if (waterCell >= 0) return;

            if (!landing.sinks) {
                if (!seen.has(landing.cell)) {
                    seen.add(landing.cell);
                    positions.push(landing.cell);
                }
            } else if (accepts(landing.cell)) {
                waterCell = landing.cell;
            }
        });

        if (waterCell >= 0) break;
    }

    return waterCell;
}

/**
 * The water cell where the Rock in `rockCell` sinks into a bridge that joins new ground, else -1. The cells beside a
 * water cell that joined nothing go to `miss` as well.
 */
function bridgeOf(walkGrid: WalkGrid, floodState: FloodState, rockCell: number, miss: PressMiss): number {
    return sinkOf(
        walkGrid,
        floodState,
        rockCell,
        miss,
        (waterCell) => !floodState.bridged.has(waterCell) && joinsNewGround(walkGrid, floodState, waterCell, miss),
    );
}

/**
 * Whether the Rock can still sink: it exists (a crystal Rock needs its target turned), it has not sunk, and its straight
 * bridge has not sunk it either (`bridgeTaken`).
 */
export function rockFree(walkGrid: WalkGrid, floodState: FloodState, rockIndex: number): boolean {
    if (floodState.rockSpent[rockIndex]) return false;

    const { triggers } = walkGrid;
    const { pid, target } = triggers.rocks[rockIndex];
    if (target !== undefined && !floodState.transmuted.has(target)) return false;

    const bridgeIndex = triggers.bridgeIndexOf.get(pid);
    return bridgeIndex === undefined || !floodState.bridgeTaken[bridgeIndex];
}

/**
 * Sinks the Rock `rockIndex` in `waterCell`: the cell holds the hero, and the walk resumes from the reached cells beside
 * it. The Rock bridges once, and its straight bridge is spent with it.
 */
export function sinkRock(walkGrid: WalkGrid, floodState: FloodState, rockIndex: number, waterCell: number): void {
    const { triggers, marks } = walkGrid;
    floodState.rockSpent[rockIndex] = 1;

    const bridgeIndex = triggers.bridgeIndexOf.get(triggers.rocks[rockIndex].pid);
    if (bridgeIndex !== undefined) floodState.bridgeTaken[bridgeIndex] = 1;

    floodState.bridged.add(waterCell);

    if (!(marks[waterCell] & BRIDGE_MARK)) {
        marks[waterCell] |= BRIDGE_MARK;
        floodState.turnMarked.push(waterCell);
    }

    requeue(walkGrid, floodState, waterCell);
}

/**
 * Sinks the Rocks that can be pushed into water with turns, once a hero reaches a cell beside one: each Rock bridges
 * once, at the nearest water cell it sinks in that joins new ground, and not when its straight bridge sank it already
 * (its `bridgeTaken`). A Rock whose search found nothing is looked at again only once what it reads has changed.
 * Returns whether any Rock sank.
 */
export function sinkTurned(walkGrid: WalkGrid, floodState: FloodState): boolean {
    const { triggers } = walkGrid;
    const { rocksDue, rockSeen, rockMisses } = floodState;
    let added = false;

    visitReached(floodState, floodState.rockCursor, (cell, layer) => {
        if (layer !== 0) return;

        for (const rockIndex of triggers.rocksAt.get(cell) || []) {
            if (rockSeen[rockIndex]) continue;
            rockSeen[rockIndex] = 1;
            rocksDue.push(rockIndex);
            added = true;
        }
    });

    visitSwaps(floodState, floodState.rockSwapCursor, (_heroCell, targetCell) => {
        const rockIndex = triggers.rockAt.get(targetCell);
        if (rockIndex === undefined || rockSeen[rockIndex]) return;

        rockSeen[rockIndex] = 1;
        rocksDue.push(rockIndex);
        added = true;
    });

    if (added) rocksDue.sort((first, second) => first - second);

    let sank = false;

    for (const rockIndex of rocksDue) {
        if (!rockFree(walkGrid, floodState, rockIndex)) continue;

        const { cell } = triggers.rocks[rockIndex];
        const swaps = swappedTo(floodState, cell).length;
        const miss = rockMisses[rockIndex];
        if (miss && !missChanged(walkGrid, floodState, miss, swaps)) continue;

        const newMiss: PressMiss = { inputs: pressInputs(floodState) + swaps, pushCells: [], wallStops: [] };
        const waterCell = bridgeOf(walkGrid, floodState, cell, newMiss);

        if (waterCell < 0) {
            rockMisses[rockIndex] = newMiss;
            continue;
        }

        sinkRock(walkGrid, floodState, rockIndex, waterCell);
        sank = true;
    }

    return sank;
}
