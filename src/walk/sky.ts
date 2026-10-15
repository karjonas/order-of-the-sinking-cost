// Sky entrances: whether a hero stepping off a sky ledge falls into a set of cells (WORLD.md "Ground layers")
import { cellOnSide, FIRE, PUSH, SIDES, Z_BIAS } from './cells.ts';
import { deep, layerOf } from './ocean.ts';
import { blocked, fallsThrough } from './support.ts';
import type { WalkGrid } from './walker.ts';
import { fenced } from './walls.ts';

// the ground layer of the sky
const SKY_LAYER = 2;

// a column without a step off a sky ledge
const NONE = 0x7fff;

/**
 * The sky entrances: a test of whether a hero stepping off a sky ledge falls into a cell of a set below the sky. A
 * sky ledge is the cell over a solid voxel of the sky layer (static or of an existing Group) when it is not blocked,
 * attacked or under water; the hero steps off it into a cell next to it with no Fence on the edge and no pushable in
 * it, and falls down that cell's column. The walk does not climb, so a walk from the set never meets the ledge.
 */
export function skyEntrances(walkGrid: WalkGrid): (cells: Iterable<number>) => boolean {
    const { grid, cellFlags, layerCells, width, zOffset, boxZ, worldCells, noFlood } = walkGrid;
    const solid = worldCells.solid;
    const groupCells = worldCells.groups;
    const topZ = 255 - zOffset;
    let skyBase = 1 - Z_BIAS;
    while (skyBase <= topZ && layerOf(walkGrid, skyBase) !== SKY_LAYER) skyBase++;

    // a world without a sky layer has no sky ledges
    if (skyBase > topZ) return () => false;

    // per column, the lowest z of such a step whose fall leaves the sky layer, else NONE (the lowest step of a column
    // is under its others, so when something in the sky holds its fall, it holds theirs too)
    const lowestStep = new Int16Array(layerCells).fill(NONE);

    const noteLedge = (column: number, z: number): void => {
        const ledge = (z + Z_BIAS) * layerCells + column;
        const ledgeUnusable = blocked(walkGrid, noFlood, ledge) || cellFlags[ledge] & FIRE || deep(walkGrid, ledge);
        if (ledgeUnusable) return;
        if (layerOf(walkGrid, z) !== SKY_LAYER) return;

        for (const side of SIDES) {
            const air = cellOnSide(walkGrid, ledge, side);
            if (grid[air] & PUSH || fenced(walkGrid, ledge, side, air)) continue;
            if (!fallsThrough(walkGrid, noFlood, air, z)) continue;

            const airColumn = air % layerCells;
            if (z < lowestStep[airColumn]) lowestStep[airColumn] = z;
        }
    };

    // a ledge is the cell over a voxel: the static ones per column (a count n, then n z bytes), then the group cells
    // as (column, row, z byte) triplets
    let offset = 0;

    for (let column = 0; column < layerCells; column++) {
        for (let count = solid[offset++]; count > 0; count--) {
            const z = solid[offset++] - zOffset + 1;
            if (z >= skyBase && z < boxZ) noteLedge(column, z);
        }
    }

    for (let triplet = 0; triplet < groupCells.length; triplet += 3) {
        const z = groupCells[triplet + 2] - zOffset + 1;
        const column = groupCells[triplet + 1] * width + groupCells[triplet];
        if (z >= skyBase && z < boxZ) noteLedge(column, z);
    }

    // a step whose fall something in the sky layer holds leads nowhere below
    for (let column = 0; column < layerCells; column++) {
        if (lowestStep[column] === NONE) continue;
        const startZ = lowestStep[column] - 1;
        let cell = (startZ + Z_BIAS) * layerCells + column;

        for (let z = startZ; z >= skyBase; z--) {
            if (!fallsThrough(walkGrid, noFlood, cell, z)) {
                lowestStep[column] = NONE;
                break;
            }
            cell -= layerCells;
        }
    }

    // whether the hero falls through every cell over `cell` (at cellZ) up to the sky layer
    const openToSky = (cell: number, cellZ: number): boolean => {
        let over = cell + layerCells;

        for (let z = cellZ + 1; z < skyBase; z++) {
            if (!fallsThrough(walkGrid, noFlood, over, z)) return false;
            over += layerCells;
        }
        return true;
    };

    return (cells) => {
        for (const cell of cells) {
            const cellZ = Math.floor(cell / layerCells) - Z_BIAS;
            if (cellZ < skyBase && lowestStep[cell % layerCells] !== NONE && openToSky(cell, cellZ)) return true;
        }
        return false;
    };
}
