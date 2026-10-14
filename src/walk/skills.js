// Wardrobes, the hero's walk layer and the TELEPORT swap (SKILLS.md "Wardrobes", "TELEPORT and PULL")
import { PROTECTION_FLAG, rawU32, TELEPORT_FLAG } from '../save.js';
import { cellOnSide, cellOf, keyOf } from './cells.js';
import { exists } from './groups.js';
import { blocked, insideWall, land } from './support.js';

// walk layers: any skill, PROTECTION, TELEPORT
export const PROTECTED = 1,
    WIZARD = 2;

// A Wardrobe door is the cell edge its +x axis points to: fire does not cross it; a hero leaving through it adds its
// skill (1 PROTECTION, 2 another) to the ones it has, in place of SINGLE_PUSH, and one entering through it gets the
// default skill back; the cell's other edges and vertical moves change nothing. doorOut: the skill of the door a hero
// leaving `cell` on side `side` passes; doorIn: that of the door a hero entering `cell` from side `side` passes; -1
// when no door is there.
export function doorOut(walkGrid, cell, side) {
    const wardrobe = walkGrid.wardrobes.get(cell);
    if (wardrobe?.[0] === side) return wardrobe[1];
    return -1;
}
export function doorIn(walkGrid, cell, side) {
    const wardrobe = walkGrid.wardrobes.get(cell);
    if (wardrobe?.[0] === (side + 2) % 4) return wardrobe[1];
    return -1;
}
// per existing Wardrobe cell, its [door side, skill]
export function placeWardrobes(walkGrid) {
    for (const [pid, i, j, z, side, skill, ex] of walkGrid.world.wardrobes || []) {
        const cell = keyOf(walkGrid, i, j, z);
        if (cell >= 0 && exists(walkGrid, pid, ex)) walkGrid.wardrobes.set(cell, [side, skill]);
    }
}
export function placeTeleportDoors(walkGrid) {
    const teleport = walkGrid.world.teleport || [];
    for (const [pid, i, j, z] of walkGrid.world.wardrobes || []) {
        const cell = keyOf(walkGrid, i, j, z);
        if (teleport.includes(pid) && walkGrid.wardrobes.has(cell)) walkGrid.teleportDoors.add(cell);
    }
}
// the current hero's walk layer, from the latest skill_flags (else the level data's PROTECTION)
export function heroLayerOf(walkGrid) {
    const guy = walkGrid.world.guy;
    const skills = walkGrid.latest.get(guy?.[0], 'skill_flags');
    if (!skills) return guy?.[1] ? PROTECTED : 0;
    if (rawU32(skills) & PROTECTION_FLAG) return PROTECTED;
    if (rawU32(skills) & TELEPORT_FLAG) return WIZARD;
    return 0;
}
// The TELEPORT line from `cell` along a side, at the cell's z: it crosses water and air, wraps with the grid (inside
// the fast-travel box at map-room z) and ends at the first target, the cell the wizard swaps into; -1 when it ends at a
// solid voxel outside a THROUGH beam, a Tree, Sign, Treasure_Display or Judge, a shut Gate, a frozen cell, a Mirror
// (its turn is not modelled), a Wardrobe door edge, or back at the cell.
export function swapCell(walkGrid, floodState, cell, side) {
    const { width, height, mirrorCells, swapTargets } = walkGrid;
    for (
        let prev = cell, next = cellOnSide(walkGrid, cell, side), c = 0;
        c < width + height && next !== cell;
        c++, prev = next, next = cellOnSide(walkGrid, next, side)
    ) {
        if (blocked(walkGrid, floodState, next) || mirrorCells.has(next)) return -1;
        if (doorOut(walkGrid, prev, side) >= 0 || doorIn(walkGrid, next, side) >= 0) return -1;
        if (swapTargets.has(next)) return next;
    }
    return -1;
}
// the current hero's seed: [cell, layer]
export function heroSeed(walkGrid, position) {
    const cell = cellOf(walkGrid, ...position),
        heroLayer = walkGrid.heroLayer;
    if (heroLayer === PROTECTED && walkGrid.attacked.has(cell)) return [cell, PROTECTED];
    if (insideWall(walkGrid, cell)) return [-1, heroLayer];
    return [land(walkGrid, walkGrid.noFlood, cell, false), heroLayer];
}
// a hero leaving a Wardrobe by its door takes its skill (PROTECTION, TELEPORT, or another one on top of its own); one
// entering a Wardrobe by its door gets the default skill back
export function layerAfterStep(walkGrid, cell, side, next, layer) {
    const out = doorOut(walkGrid, cell, side);
    if (out === 1) return PROTECTED;
    if (out > 1) {
        if (walkGrid.teleportDoors.has(cell)) return WIZARD;
        return layer;
    }
    if (doorIn(walkGrid, next, side) > 0) return 0;
    return layer;
}
