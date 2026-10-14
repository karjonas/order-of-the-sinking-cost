// What blocks the hero and what holds the hero up while a flood runs (MOVEMENT.md "Support", "Falling", VIEWER.md
// "Support and open cells")
import { FIRE, FLOOR, GATE, SOLID, SUPPORT, THRU, ZB } from './cells.js';
import { deep, layerOf, waterAt } from './ocean.js';

// a hero position inside a wall that no beam runs through seeds no walk: the save stores the cell the hero stood
// in, so it is neither lifted on top of the wall nor dropped below it
export function insideWall(walkGrid, cell) {
    return cell >= 0 && (walkGrid.grid[cell] & SOLID) !== 0 && !(walkGrid.cellFlags[cell] & THRU);
}
// a Gate's cell that is shut while a flood runs: a shut Gate the flood has not opened, or an open notted Gate that a
// switch press has shut
export function gateShutNow(walkGrid, floodState, cell) {
    const latchedShut = floodState.latchedShut;
    if (latchedShut.size && latchedShut.has(cell)) return true;
    if ((walkGrid.grid[cell] & (GATE | SOLID)) !== GATE) return false;
    return !floodState.opened.has(cell) && !floodState.unlatched.has(cell);
}
// what the hero cannot enter: a closed ice gate, a solid voxel outside a THROUGH beam, a shut Gate
export function blocked(walkGrid, floodState, cell) {
    if (walkGrid.grid[cell] & SOLID) return !(walkGrid.cellFlags[cell] & THRU) || walkGrid.frozen.has(cell);
    return gateShutNow(walkGrid, floodState, cell) || walkGrid.frozen.has(cell);
}
function gateOpenedNow(walkGrid, floodState, cell) {
    if ((walkGrid.grid[cell] & (GATE | SOLID)) !== GATE) return false;
    return floodState.opened.has(cell) || floodState.unlatched.has(cell);
}
export function heldFromBelow(walkGrid, floodState, cell) {
    const layerCells = walkGrid.layerCells;
    if (cell < layerCells) return false;
    const below = cell - layerCells;
    if (floodState.latchedShut.size && floodState.latchedShut.has(below)) return true;
    return (walkGrid.grid[below] & SUPPORT) !== 0 && !gateOpenedNow(walkGrid, floodState, below);
}
// a solid voxel in the cell itself (entered only along a THROUGH beam; the game holds an entity inside a wall), a lily
// or floor in the cell (a Lily on a river at every cell of its drift: the hero boards it as it passes and rides it),
// solid or a rock below, a DOUBLE beam over water (the hero stands on the surface), else the implicit
// ground floor (z <= 0, z < 0 in water). `driftCells` is filled once the beams have marked the cells they run through,
// before the first call.
function supported(walkGrid, floodState, cell) {
    if (walkGrid.grid[cell] & (SOLID | FLOOR) || heldFromBelow(walkGrid, floodState, cell)) return true;
    if (floodState.bridged.has(cell) || walkGrid.driftCells.has(cell)) return true;
    if (floodState.pocket && walkGrid.bridgeWater.has(cell)) return true;
    const layerCells = walkGrid.layerCells,
        z = Math.floor(cell / layerCells) - ZB,
        wz = waterAt(walkGrid, cell % layerCells, z);
    if (wz != null && walkGrid.doubleBeams.has(cell) && Math.abs(z - wz) < 0.6) return true;
    if (layerOf(walkGrid, z) !== 0) return false;
    if (wz != null) return z < 0;
    return z <= 0;
}
export function standable(walkGrid, floodState, cell) {
    if (cell < 0 || cell >= walkGrid.grid.length) return false;
    return !blocked(walkGrid, floodState, cell) && supported(walkGrid, floodState, cell);
}
// the cell the hero stands in at `cell`, else one up or down; an Area_Pin (up = false) is touched, not stood on: one
// inside a wall does not put the hero on top of it
export function land(walkGrid, floodState, cell, up = true) {
    if (cell < 0) return -1;
    if (standable(walkGrid, floodState, cell)) return cell;
    const layerCells = walkGrid.layerCells;
    if (up && standable(walkGrid, floodState, cell + layerCells)) return cell + layerCells;
    if (standable(walkGrid, floodState, cell - layerCells)) return cell - layerCells;
    return -1;
}
// whether `cell` at height z holds a pushed stone: a floor, or below it what holds up the cell above at some point of
// the flood (a Gate the flood has opened held the stone before it opened; an open notted Gate a switch press has shut
// holds it from then on)
export function holdsStone(walkGrid, floodState, cell, z) {
    const { grid, layerCells } = walkGrid;
    if (grid[cell] & FLOOR) return true;
    if (cell >= layerCells && grid[cell - layerCells] & SUPPORT) return true;
    if (floodState.latchedShut.size && floodState.latchedShut.has(cell - layerCells)) return true;
    return z <= 0 && layerOf(walkGrid, z) === 0 && waterAt(walkGrid, cell % layerCells, z) == null;
}
// whether a hero falling into cell c (at z) falls on through it: it is not blocked or attacked, and nothing holds
// the hero there (off the ground layer and away from water only a floor or what stands below can)
export function fallsThrough(walkGrid, floodState, cell, z) {
    if (blocked(walkGrid, floodState, cell) || walkGrid.cellFlags[cell] & FIRE) return false;
    if (layerOf(walkGrid, z) === 0 || walkGrid.waterColumns[cell % walkGrid.layerCells])
        return !standable(walkGrid, floodState, cell) && !deep(walkGrid, cell);
    return !(walkGrid.grid[cell] & FLOOR) && !heldFromBelow(walkGrid, floodState, cell);
}
