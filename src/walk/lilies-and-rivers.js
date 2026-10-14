// Lilies and the rivers they drift on (MOVEMENT.md "Lilies", "Rivers")
import { cellOnSide, BEAMSTOP, FLOOR, keyOf, PUSH, ZB } from './cells.js';
import { exists, place, put } from './groups.js';
import { waterAt } from './ocean.js';
import { blocked } from './support.js';
import { latestCell } from './walls.js';

function addLily(walkGrid, cell, pid) {
    const there = walkGrid.liliesAt.get(cell);
    if (there) there.add(pid);
    else walkGrid.liliesAt.set(cell, new Set([pid]));
}
export function placeLilies(walkGrid) {
    for (const [pid, i, j, z, ex] of walkGrid.world.lilies)
        for (const cell of [keyOf(walkGrid, i, j, z), latestCell(walkGrid, pid, i, j, z)]) {
            if (cell < 0) continue;
            place(walkGrid, pid, ex, () => {
                put(walkGrid, walkGrid.grid, cell, FLOOR);
                if (walkGrid.writeLog) return;
                walkGrid.lilyCells.add(cell);
                addLily(walkGrid, cell, pid);
            });
        }
}
export function placeRivers(walkGrid) {
    for (const [i, j, z, dir] of walkGrid.world.rivers || []) walkGrid.flowSide.set(keyOf(walkGrid, i, j, z), dir - 1);
}
// Lilies drift in real time with the river under them, so a Lily on a river is at every cell of its drift from
// where the save last left it (until a step is blocked or the drift repeats), not at that cell alone. A Lily that
// does not exist drifts nowhere.
export function placeDrift(walkGrid) {
    const { world, flowSide, driftCells, width, height, layerCells } = walkGrid;
    for (const [pid, i, j, z, ex] of world.lilies) {
        if (!exists(walkGrid, pid, ex)) continue;
        const start = latestCell(walkGrid, pid, i, j, z);
        if (start < 0 || !flowSide.has(start)) continue;
        const lilyZ = Math.floor(start / layerCells) - ZB,
            states = new Set();
        let cur = start,
            side = flowSide.get(start);
        driftCells.add(start);
        for (let step = 0; step < 4 * (width + height); step++) {
            if (flowSide.has(cur)) side = flowSide.get(cur);
            const state = cur * 4 + side;
            if (states.has(state)) break;
            states.add(state);
            const n = cellOnSide(walkGrid, cur, side);
            if (!lilyEnters(walkGrid, walkGrid.noFlood, n, lilyZ)) break;
            cur = n;
            driftCells.add(n);
            addLily(walkGrid, n, pid);
        }
    }
}
// A stone that comes to rest on a Lily kicks it along its own heading; the Lily then drifts with the river under
// it (coasting on in its last direction over still water) until a step is blocked or the drift repeats. The
// cells it rides through, from the landing cell on.
export function lilyRide(walkGrid, start, kickSide, z) {
    const { flowSide, width, height } = walkGrid;
    const cells = [start],
        states = new Set();
    let cur = start,
        side = kickSide;
    for (let step = 0; step < 4 * (width + height); step++) {
        if (step > 0 && flowSide.has(cur)) side = flowSide.get(cur);
        const state = cur * 4 + side;
        if (states.has(state)) break;
        states.add(state);
        const n = cellOnSide(walkGrid, cur, side);
        if (!lilyEnters(walkGrid, walkGrid.noFlood, n, z)) continue;
        cur = n;
        if (!cells.includes(n)) cells.push(n);
    }
    return cells;
}
// whether a drifting Lily at height z can enter `cell`
function lilyEnters(walkGrid, floodState, cell, z) {
    const wz = waterAt(walkGrid, cell % walkGrid.layerCells, z);
    if (wz == null || Math.abs(z - wz) > 0.5) return false;
    return !blocked(walkGrid, floodState, cell) && !(walkGrid.grid[cell] & (PUSH | BEAMSTOP));
}
