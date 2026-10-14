// The solid voxels, the entities that stand in cells and the Fences of a walker's grid (VIEWER.md "Cells")
import { WORLD } from '../data.js';
import { latestF32, rawU16 } from '../save.js';
import { BEAMSTOP, cellOf, FLOOR, keyOf, MOVABLE, ROCK, SOLID, SUPPORT, ZB } from './cells.js';
import { place, put } from './groups.js';

// Rock.properties
const MIRRORABLE = 1,
    // the world.json movables kind of a Mirror
    MIRROR_KIND = 2;

// the cell an entity stands in where the save last left it, else at its level-data column, row and z
export function latestCell(walkGrid, pid, column, row, z) {
    const lt = walkGrid.latest;
    return cellOf(
        walkGrid,
        latestF32(lt, pid, 'base.position.x', column + walkGrid.cornerX),
        latestF32(lt, pid, 'base.position.y', row + walkGrid.cornerY),
        latestF32(lt, pid, 'base.position.z', z),
    );
}
export function placeVoxels(walkGrid) {
    const { world, grid, layerCells, zOffset, width } = walkGrid,
        solid = WORLD.solid,
        groupCells = WORLD.groups;
    for (let column = 0, p = 0; column < layerCells; column++)
        for (let n = solid[p++]; n > 0; n--) grid[(solid[p++] - zOffset + ZB) * layerCells + column] = SOLID | SUPPORT;
    for (let groupIndex = 0, p = 0; groupIndex < world.groups.length; p += 3 * world.groups[groupIndex++].n) {
        const group = world.groups[groupIndex],
            start = p;
        place(walkGrid, group.pid, group.exists, () => {
            for (let n = 0, q = start; n < group.n; n++, q += 3) {
                const cell =
                    (groupCells[q + 2] - zOffset + ZB) * layerCells + groupCells[q + 1] * width + groupCells[q];
                put(walkGrid, grid, cell, SOLID | SUPPORT);
            }
        });
    }
}
export function noteTarget(walkGrid, cell, movableKind) {
    if (movableKind === MIRROR_KIND) walkGrid.mirrorCells.add(cell);
    else walkGrid.swapTargets.add(cell);
}
// a beam passes a Rock whose latest `properties` (else its level-data ones) hold MIRRORABLE, and a mirrorable Rover
function beamBits(walkGrid, pid, mirrorable) {
    const properties = walkGrid.latest.get(pid, 'properties');
    let passes = false;
    if (properties) passes = (rawU16(properties) & MIRRORABLE) !== 0;
    else passes = mirrorable.has(pid);
    if (passes) return 0;
    return BEAMSTOP;
}
// the bits of an entity the save created: a Rock (a TRANSMUTE crystal) not in the level data, or a Tree
function createdBits(walkGrid, pid, created, known, mirrorable) {
    if (created.destroyed) return 0;
    if (created.type === 'Rock' && !known.has(pid)) return SUPPORT | ROCK | beamBits(walkGrid, pid, mirrorable);
    if (created.type === 'Tree') return SOLID | SUPPORT | BEAMSTOP;
    return 0;
}
// Per entity list: [list, index of its level-data `ex`, whether it stands where the save last left it, its bits].
// Rocks hold up what stands on them; Trees (while they exist: TRANSMUTE turns one into a crystal Rock), Signs,
// Treasure_Displays and Judges cannot be pushed: they block the hero, hold up what stands on them and stop beams.
// Returns the Rocks still at their level-data cell.
export function placeEntities(walkGrid) {
    const { world, grid } = walkGrid;
    const known = new Set(world.rocks.map(([pid]) => pid)),
        unmoved = new Set(),
        mirrorable = new Set(world.mirrorable || []);
    for (const [list, exIndex, latest, bits] of [
        [world.rocks, 4, true, SUPPORT | ROCK],
        [world.floors, 4, false, FLOOR],
        [world.trees || [], 4, false, SOLID | SUPPORT | BEAMSTOP],
        [world.blockers || [], 4, false, SOLID | SUPPORT | BEAMSTOP],
        [world.movables || [], 5, true, MOVABLE],
    ])
        for (const entity of list) {
            const [pid, column, row, z] = entity,
                cell = latest ? latestCell(walkGrid, pid, column, row, z) : keyOf(walkGrid, column, row, z),
                cellBits = bits & (ROCK | MOVABLE) ? bits | beamBits(walkGrid, pid, mirrorable) : bits;
            if (cell < 0) continue;
            place(walkGrid, pid, entity[exIndex], () => {
                put(walkGrid, grid, cell, cellBits);
                if (walkGrid.writeLog) return;
                if (bits & ROCK && cell === keyOf(walkGrid, column, row, z)) unmoved.add(pid);
                if (bits & ROCK) noteTarget(walkGrid, cell, -1);
                if (bits & MOVABLE) noteTarget(walkGrid, cell, entity[4]);
            });
        }
    // the Rocks (TRANSMUTE crystals) and Trees the save created, where it last left them
    for (const [pid, created] of walkGrid.latest.created) {
        const bits = createdBits(walkGrid, pid, created, known, mirrorable);
        const cell = bits ? latestCell(walkGrid, pid, 0, 0, 0) : -1;
        if (cell < 0) continue;
        grid[cell] |= bits;
        if (bits & ROCK) noteTarget(walkGrid, cell, -1);
    }
    for (const [i, j, z] of world.beam_stops || []) {
        const cell = keyOf(walkGrid, i, j, z);
        if (cell >= 0) grid[cell] |= BEAMSTOP;
    }
    return unmoved;
}
export function placeFences(walkGrid) {
    for (const [pid, i, j, z, side, ex] of walkGrid.world.fences) {
        const cell = keyOf(walkGrid, i, j, z);
        if (cell >= 0) place(walkGrid, pid, ex, () => put(walkGrid, walkGrid.cellFlags, cell, 1 << side));
    }
}
// a fence on side `side` of `cell`, or on the facing side of its neighbour that way
export function fenced(walkGrid, cell, side, neighbour) {
    const cellFlags = walkGrid.cellFlags;
    return ((cellFlags[cell] >> side) & 1) !== 0 || ((cellFlags[neighbour] >> ((side + 2) % 4)) & 1) !== 0;
}
