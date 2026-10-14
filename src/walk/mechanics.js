// The mechanics the walk models in part or not at all (VIEWER.md "What the walk leaves out")
import { rawU16 } from '../save.js';
import { DIRS, keyOf, neighbourOf, ZB } from './cells.js';
import { exists } from './groups.js';
import { waterAt } from './ocean.js';
import { latestCell } from './walls.js';

// the unmodelled mechanics of world.mechs, by kind (the progress's `why`)
export const MECHS = ['dragon', 'beam', 'mirror', 'stones'];
// mechanics the walk models only in part or not at all, by cell (bit 1 << kind: dragon, beam, mirror, skipping
// stone): the 3 x 3 x 3 cells around each existing one (a mirror and a skipping stone where the save last left it, a
// skipping stone unless it sank: flipped, `properties` FLIPPING_TARGET, or under the water surface), a dragon's fire,
// and the lights and their beams' cells
export function placeMechanics(walkGrid) {
    const { world, latest, mechanics, grid, layerCells } = walkGrid;
    const mark = (cell, bit) => {
        if (cell >= 0) mechanics.set(cell, (mechanics.get(cell) || 0) | bit);
    };
    for (const [kind, pid, column, row, z, ex] of world.mechs || []) {
        if (!exists(walkGrid, pid, ex)) continue;
        let cell = keyOf(walkGrid, column, row, z);
        // a Mirror or MIRRORABLE Rock is marked where the save last left it; a smashed or destroyed one is gone
        if (kind === 2) cell = latestCell(walkGrid, pid, column, row, z);
        if (kind === 3) {
            const pr = latest.get(pid, 'properties');
            cell = latestCell(walkGrid, pid, column, row, z);
            const zz = Math.floor(cell / layerCells) - ZB,
                wz = cell >= 0 ? waterAt(walkGrid, cell % layerCells, zz) : null;
            if (cell < 0 || (pr && rawU16(pr) & 8) || (wz != null && zz < wz)) continue;
        }
        const b = 1 << kind;
        for (let dz = -1; dz <= 1; dz++) {
            const kz = cell + dz * layerCells;
            if (cell < 0 || kz < 0 || kz >= grid.length) continue;
            for (let dx = -1; dx <= 1; dx++)
                for (let dy = -1; dy <= 1; dy++) mark(neighbourOf(walkGrid, kz, dx, dy), b);
        }
    }
    for (const k of walkGrid.burning) mark(k, 1);
    for (const k of walkGrid.litCells) mark(k, 2);
    if (!belowBox(walkGrid, mechanics)) return;
    const mechanicsNear = new Map();
    const near = (k) => {
        if (mechanicsNear.has(k)) return;
        let b = mechanics.get(k) || 0;
        for (const [dx, dy] of DIRS) b |= mechanics.get(neighbourOf(walkGrid, k, dx, dy)) || 0;
        mechanicsNear.set(k, b);
    };
    for (const k of mechanics.keys()) {
        near(k);
        for (const [dx, dy] of DIRS) near(neighbourOf(walkGrid, k, -dx, -dy));
    }
    walkGrid.mechanicsNear = mechanicsNear;
}
// Per cell, the cells whose step one way (DIRS) leads to it are its neighbours the other way, except at the edge of
// the fast-travel box, which wraps on its own: `near` sets of cells below the box z are found from their neighbours.
function belowBox(walkGrid, cells) {
    return [...cells.keys()].every((k) => Math.floor(k / walkGrid.layerCells) - ZB < walkGrid.boxZ);
}
// the mechanics in or next to a set of cells (mechanicsNear null: some lie in the fast-travel rooms)
export function mechAt(walkGrid, cells) {
    const { mechanics, mechanicsNear } = walkGrid;
    let bits = 0;
    if (!mechanics.size) return bits;
    if (!mechanicsNear) {
        for (const k of cells) {
            bits |= mechanics.get(k) || 0;
            for (const [dx, dy] of DIRS) bits |= mechanics.get(neighbourOf(walkGrid, k, dx, dy)) || 0;
        }
        return bits;
    }
    if (mechanicsNear.size < cells.size) {
        for (const [k, v] of mechanicsNear) if (v & ~bits && cells.has(k)) bits |= v;
    } else for (const k of cells) bits |= mechanicsNear.get(k) || 0;
    return bits;
}
