// Sky entrances: whether a hero stepping off a sky ledge falls into a set of cells (WORLD.md "Ground layers")
import { WORLD } from '../data.js';
import { cellOnSide, FIRE, PUSH, SIDES, ZB } from './cells.js';
import { deep, layerOf } from './ocean.js';
import { blocked, fallsThrough } from './support.js';
import { fenced } from './walls.js';

// The sky entrances: a test of whether a hero stepping off a sky ledge falls into a cell of a set below the sky. A
// sky ledge is the cell over a solid voxel of the sky layer (static or of an existing Group) when it is not blocked,
// attacked or under water; the hero steps off it into a cell next to it with no Fence on the edge and no pushable in
// it, and falls down that cell's column. The walk does not climb, so a walk from the set never meets the ledge.
export function skyEntrances(walkGrid) {
    const { grid, cellFlags, layerCells, width, zOffset, boxZ } = walkGrid,
        solid = WORLD.solid,
        groupCells = WORLD.groups;
    const topZ = 255 - zOffset;
    let skyBase = 1 - ZB;
    while (skyBase <= topZ && layerOf(walkGrid, skyBase) !== 2) skyBase++;
    // a world without a sky layer has no sky ledges
    if (skyBase > topZ) return () => false;
    // per column, the lowest z of such a step whose fall leaves the sky layer, else NONE (the lowest step of a
    // column is under its others, so when something in the sky holds its fall, it holds theirs too)
    const NONE = 0x7fff,
        lowestStep = new Int16Array(layerCells).fill(NONE);
    const noteLedge = (column, z) => {
        const ledge = (z + ZB) * layerCells + column;
        if (blocked(walkGrid, walkGrid.noFlood, ledge) || cellFlags[ledge] & FIRE || deep(walkGrid, ledge)) return;
        if (layerOf(walkGrid, z) !== 2) return;
        for (const side of SIDES) {
            const air = cellOnSide(walkGrid, ledge, side);
            if (
                grid[air] & PUSH ||
                fenced(walkGrid, ledge, side, air) ||
                !fallsThrough(walkGrid, walkGrid.noFlood, air, z)
            )
                continue;
            if (z < lowestStep[air % layerCells]) lowestStep[air % layerCells] = z;
        }
    };
    for (let column = 0, p = 0; column < layerCells; column++)
        for (let n = solid[p++]; n > 0; n--) {
            const z = solid[p++] - zOffset + 1;
            if (z >= skyBase && z < boxZ) noteLedge(column, z);
        }
    for (let q = 0; q < groupCells.length; q += 3) {
        const z = groupCells[q + 2] - zOffset + 1;
        if (z >= skyBase && z < boxZ) noteLedge(groupCells[q + 1] * width + groupCells[q], z);
    }
    for (let column = 0; column < layerCells; column++) {
        if (lowestStep[column] === NONE) continue;
        for (let z = lowestStep[column] - 1, k = (z + ZB) * layerCells + column; z >= skyBase; z--, k -= layerCells)
            if (!fallsThrough(walkGrid, walkGrid.noFlood, k, z)) {
                lowestStep[column] = NONE;
                break;
            }
    }
    // whether the hero falls through every cell over `cell` (at cellZ) up to the sky layer
    const openToSky = (cell, cellZ) => {
        for (let c = cell + layerCells, z = cellZ + 1; z < skyBase; c += layerCells, z++)
            if (!fallsThrough(walkGrid, walkGrid.noFlood, c, z)) return false;
        return true;
    };
    return (S) => {
        for (const k of S) {
            const zk = Math.floor(k / layerCells) - ZB;
            if (zk < skyBase && lowestStep[k % layerCells] !== NONE && openToSky(k, zk)) return true;
        }
        return false;
    };
}
