// Rocks that sink side by side: the second Rock is pushed over the water cell the first one bridged, so a gap of two or
// three water cells closes (MOVEMENT.md "Objects in water", VIEWER.md "Moves")
import { BRIDGE_MARK, cellOnSide, SIDES, Z_BIAS } from './cells.ts';
import type { FloodState } from './flood.ts';
import { missChanged, pressInputs } from './gates.ts';
import type { PressMiss } from './gates.ts';
import { levelWater } from './ocean.ts';
import { joinsNewGround, rockFree, sinkOf, sinkRock } from './rock-turns.ts';
import { blocked, standable } from './support.ts';
import { swappedTo } from './swaps.ts';
import type { WalkGrid } from './walker.ts';

// the most Rocks one gap takes: a gap of three water cells in a row
const CHAIN_ROCKS = 3;

/** A Rock's last failed search for a gap, and how many Rocks were due then. */
export interface ChainMiss {
    due: number;
    miss: PressMiss;
}

/** The Rock `rockIndex` sinking in `waterCell` as one step of a gap. */
interface ChainStep {
    rockIndex: number;
    waterCell: number;
}

/** What a water cell was before a search took it for a bridge: marked as one, and the layers that reached it. */
interface Assumed {
    waterCell: number;
    marked: boolean;
    visited: number;
}

/**
 * Takes `waterCell` for a bridge the hero stands on, while a search looks for the Rocks that sink after the one that
 * sank there: it holds a pushed Rock, a hero in it counts as reached and it is standable.
 */
function assume(walkGrid: WalkGrid, floodState: FloodState, waterCell: number): Assumed {
    const { marks, visited } = walkGrid;
    const assumed: Assumed = {
        waterCell,
        marked: (marks[waterCell] & BRIDGE_MARK) !== 0,
        visited: visited[waterCell],
    };

    floodState.bridged.add(waterCell);
    marks[waterCell] |= BRIDGE_MARK;
    visited[waterCell] |= 1;
    return assumed;
}

/** Puts the water cell back as it was before assume(). */
function retract(walkGrid: WalkGrid, floodState: FloodState, assumed: Assumed): void {
    const { waterCell } = assumed;
    floodState.bridged.delete(waterCell);
    if (!assumed.marked) walkGrid.marks[waterCell] &= ~BRIDGE_MARK;
    walkGrid.visited[waterCell] = assumed.visited;
}

/** Whether a cell beside `waterCell` is reached, which is where the hero stands to step onto its bridge. */
function reachedBeside(walkGrid: WalkGrid, waterCell: number, miss: PressMiss): boolean {
    let reached = false;

    for (const side of SIDES) {
        const beside = cellOnSide(walkGrid, waterCell, side);
        miss.pushCells.push(beside);
        if (walkGrid.visited[beside] !== 0) reached = true;
    }

    return reached;
}

/** Whether a cell beside `waterCell` is a cell a hero stands in that the flood has not reached. */
function newGroundBeside(walkGrid: WalkGrid, floodState: FloodState, waterCell: number, miss: PressMiss): boolean {
    for (const side of SIDES) {
        const beside = cellOnSide(walkGrid, waterCell, side);
        miss.pushCells.push(beside);

        if (walkGrid.visited[beside] !== 0 || floodState.outside?.has(beside)) continue;
        if (standable(walkGrid, floodState, beside)) return true;
    }

    return false;
}

/**
 * Whether open water, at most `waterLeft` cells in a row from a cell beside `waterCell`, leads to ground the flood has
 * not reached. The cells looked at go to `miss`.
 */
function leadsToNewGround(
    walkGrid: WalkGrid,
    floodState: FloodState,
    waterCell: number,
    waterLeft: number,
    miss: PressMiss,
): boolean {
    const z = Math.floor(waterCell / walkGrid.layerCells) - Z_BIAS;

    for (const side of SIDES) {
        const next = cellOnSide(walkGrid, waterCell, side);
        if (floodState.bridged.has(next) || blocked(walkGrid, floodState, next)) continue;
        if (standable(walkGrid, floodState, next) || !levelWater(walkGrid, next, z)) continue;

        if (newGroundBeside(walkGrid, floodState, next, miss)) return true;
        if (waterLeft > 1 && leadsToNewGround(walkGrid, floodState, next, waterLeft - 1, miss)) return true;
    }

    return false;
}

/** What a Rock can do as a link of a chain: the water cell where it joins new ground, else -1, and its steps. */
interface Links {
    finish: number;
    stepCells: number[];
}

/**
 * Where the Rock `rockIndex` sinks as a link of a chain with `rocksLeft` Rocks still to come, itself included: a water
 * cell where it joins new ground (`finish`), else the water cells beside reached ground that open water leads on from to
 * new ground, within the Rocks left (`stepCells`). The push cells turned down go to `miss`.
 */
function linksOf(
    walkGrid: WalkGrid,
    floodState: FloodState,
    rockIndex: number,
    rocksLeft: number,
    miss: PressMiss,
): Links {
    const stepCells: number[] = [];

    const finish = sinkOf(walkGrid, floodState, walkGrid.triggers.rocks[rockIndex].cell, miss, (waterCell) => {
        if (joinsNewGround(walkGrid, floodState, waterCell, miss)) return true;
        if (rocksLeft < 2 || stepCells.includes(waterCell)) return false;
        if (!reachedBeside(walkGrid, waterCell, miss)) return false;

        if (leadsToNewGround(walkGrid, floodState, waterCell, rocksLeft - 1, miss)) stepCells.push(waterCell);
        return false;
    });

    return { finish, stepCells };
}

/**
 * The Rocks, in order, that close a gap with the Rock `rockIndex` as the next link after the steps of `chain`: it sinks
 * where it joins new ground, or in a water cell that the next Rock of `available` (none twice) goes on from with that
 * water cell bridged and the hero standing in it. The chain has at most CHAIN_ROCKS Rocks. The push cells turned down go
 * to `miss`.
 */
function closeGap(
    walkGrid: WalkGrid,
    floodState: FloodState,
    rockIndex: number,
    available: number[],
    chain: ChainStep[],
    miss: PressMiss,
): ChainStep[] | null {
    const { finish, stepCells } = linksOf(walkGrid, floodState, rockIndex, CHAIN_ROCKS - chain.length, miss);
    if (finish >= 0) return [...chain, { rockIndex, waterCell: finish }];

    for (const waterCell of stepCells) {
        const assumed = assume(walkGrid, floodState, waterCell);
        const found = closeWith(walkGrid, floodState, available, [...chain, { rockIndex, waterCell }], miss);
        retract(walkGrid, floodState, assumed);

        if (found) return found;
    }

    return null;
}

/** The chain that closes the gap after the steps of `chain`, with the first of the Rocks of `available` that does. */
function closeWith(
    walkGrid: WalkGrid,
    floodState: FloodState,
    available: number[],
    chain: ChainStep[],
    miss: PressMiss,
): ChainStep[] | null {
    for (const rockIndex of available) {
        if (chain.some((step) => step.rockIndex === rockIndex)) continue;

        const found = closeGap(walkGrid, floodState, rockIndex, available, chain, miss);
        if (found) return found;
    }

    return null;
}

/** How many TELEPORT swaps have put an object in the cell of one of the Rocks `rockIndices`. */
function swapsOfRocks(walkGrid: WalkGrid, floodState: FloodState, rockIndices: number[]): number {
    let count = 0;

    for (const rockIndex of rockIndices) {
        count += swappedTo(floodState, walkGrid.triggers.rocks[rockIndex].cell).length;
    }

    return count;
}

/**
 * Sinks Rocks side by side in a gap of up to three water cells, once the Rocks that turn have bridged what they can alone:
 * each Rock a hero has reached a cell beside is searched as the first of a chain (closeGap), and the Rocks of a chain
 * that closes a gap all sink, each once. Nothing sinks for a chain that does not close, since the Rocks sunk in its first
 * water cells would join no new ground. A Rock whose search found no chain is looked at again only once what it reads
 * has changed or another Rock is due. Returns whether any Rock sank.
 */
export function sinkChained(walkGrid: WalkGrid, floodState: FloodState): boolean {
    const { rocksDue, chainMisses } = floodState;
    const swaps = swapsOfRocks(walkGrid, floodState, rocksDue);
    let sank = false;

    for (const rockIndex of rocksDue) {
        if (!rockFree(walkGrid, floodState, rockIndex)) continue;

        const known = chainMisses[rockIndex];
        if (known && known.due === rocksDue.length && !missChanged(walkGrid, floodState, known.miss, swaps)) continue;

        const miss: PressMiss = { inputs: pressInputs(floodState) + swaps, pushCells: [], wallStops: [] };
        const available = rocksDue.filter((candidate) => rockFree(walkGrid, floodState, candidate));
        const chain = closeGap(walkGrid, floodState, rockIndex, available, [], miss);

        if (!chain) {
            chainMisses[rockIndex] = { due: rocksDue.length, miss };
            continue;
        }

        for (const { rockIndex: sunkIndex, waterCell } of chain) {
            sinkRock(walkGrid, floodState, sunkIndex, waterCell);
        }

        sank = true;
    }

    return sank;
}
