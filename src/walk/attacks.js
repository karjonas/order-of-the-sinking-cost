// Dragon fire and goblin attacks (MOVEMENT.md "Goblins, dragons and PROTECTION", VIEWER.md "Attacks")
import { latestF32 } from '../save.js';
import { cellOnSide, FIRE, FIRE_STOP, GOBLIN_STOP, mod, MONSTER } from './cells.js';
import { exists, place, put } from './groups.js';
import { doorIn, doorOut } from './skills.js';
import { latestCell, noteTarget } from './walls.js';

function attack(walkGrid, cell) {
    walkGrid.attacked.add(cell);
    walkGrid.cellFlags[cell] |= FIRE;
}
// a goblin: -1; a dragon: its facing side, from its latest theta_target, else the level data's
function foeFacing(walkGrid, pid, side) {
    if (side < 0) return -1;
    const theta = latestF32(walkGrid.latest, pid, 'base.theta_target');
    if (theta !== undefined) return mod(Math.round(theta / 90), 4);
    return side;
}
// attacked cells, which kill a hero without PROTECTION and hold one with it over water or air: a living dragon's fire
// runs from its cell along its facing until a FIRE_STOP, a closed ice gate or a Wardrobe door; a living goblin attacks
// the 6 cells next to it, above and below included
export function placeAttacks(walkGrid) {
    const { world, grid, latest: lt, frozen, layerCells, width, height } = walkGrid;
    const foes = [];
    for (const [pid, i, j, z, side, ex] of world.monsters || []) {
        const cell = latestCell(walkGrid, pid, i, j, z);
        if (cell < 0 || latestF32(lt, pid, 'dead_t', 0) > 0) continue;
        // a Monster that a Group makes exist blocks its cell; its attacks are left out
        if (!exists(walkGrid, pid, ex)) {
            place(walkGrid, pid, ex, () => put(walkGrid, grid, cell, MONSTER));
            continue;
        }
        grid[cell] |= MONSTER;
        noteTarget(walkGrid, cell, -1);
        if (side >= -1) foes.push([cell, foeFacing(walkGrid, pid, side)]);
    }
    for (const [foeCell, side] of foes) {
        if (side < 0) {
            const around = [0, 1, 2, 3].map((d) => cellOnSide(walkGrid, foeCell, d));
            for (const n of around.concat([foeCell + layerCells, foeCell - layerCells]))
                if (n >= 0 && n < grid.length && !(grid[n] & GOBLIN_STOP)) attack(walkGrid, n);
            continue;
        }
        for (let cell = foeCell, count = width + height; count > 0; count--) {
            const n = cellOnSide(walkGrid, cell, side);
            if (n === foeCell || doorOut(walkGrid, cell, side) >= 0 || doorIn(walkGrid, n, side) >= 0) break;
            if (grid[n] & FIRE_STOP || frozen.has(n)) break;
            attack(walkGrid, n);
            walkGrid.burning.add(n);
            cell = n;
        }
    }
}
