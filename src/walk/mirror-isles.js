// Magic-mirror hops (MOVEMENT.md "Magic mirrors", VIEWER.md "Magic-mirror hops")
import { PROG } from '../data.js';
import { roomOf } from './beams.js';
import { addTo, cellOnSide, BEAMSTOP, GATE, MONSTER, MOVABLE, ROCK, SOLID, STEP, ZB } from './cells.js';
import { exists } from './groups.js';
import { fenced, latestCell } from './walls.js';

// Magic-mirror hops. ACTIVATE swaps every target of a room's magic Mirrors with its mirage, all or none; a hero on
// one open arm of a flat magic Mirror lands on the cell as far down the other arm. Modelled for a magic Mirror alone
// in its room (19 x 13 cells per layer), not in a closed Freezer and below the map rooms. A ray along an arm ends
// at a solid voxel, a shut Gate, a frozen cell or a Rock or movable a beam does not pass, and at a target (a
// Monster, a MIRRORABLE Rock, a mirrorable movable); the hero must stand nearer than the other arm's first stop or
// target, with no Fence on either path. hops: per arm cell, the landing cells; driftHops: the arm cells of a Mirror
// riding a lily, whose hops hold only while the lily stays where the save last left it.
export function magicMirrorHops(walkGrid) {
    const { grid, frozen, width, height, layerCells, boxZ, lilyCells, closedFreezers } = walkGrid;
    const hopsByCell = new Map(),
        drifting = new Set(),
        rayLength = Math.max(100, width, height),
        freezerOf = new Map(PROG.freezers.map((fz, fi) => [fz.pid, fi]));
    const stopsRay = (n) => {
        if (grid[n] & (SOLID | GATE) || frozen.has(n)) return true;
        return (grid[n] & (ROCK | MOVABLE)) !== 0 && (grid[n] & BEAMSTOP) !== 0;
    };
    const isTarget = (n) => {
        if (grid[n] & MONSTER) return true;
        return (grid[n] & (ROCK | MOVABLE)) !== 0 && (grid[n] & BEAMSTOP) === 0;
    };
    const sideOf = (dx, dy) => STEP.findIndex(([sx, sy]) => sx === dx && sy === dy);
    // the other arm's first target and first stop (distances), and the distance of its first Fence
    const scanOtherArm = (mirrorCell, side) => {
        const found = { target: Infinity, stop: Infinity, fence: Infinity };
        for (
            let distance = 1, k = mirrorCell, cell = cellOnSide(walkGrid, mirrorCell, side);
            distance <= rayLength;
            distance++, k = cell, cell = cellOnSide(walkGrid, cell, side)
        ) {
            if (found.fence === Infinity && fenced(walkGrid, k, side, cell)) found.fence = distance;
            if (stopsRay(cell)) {
                found.stop = distance;
                break;
            }
            if (isTarget(cell)) {
                found.target = distance;
                break;
            }
        }
        return found;
    };
    const cellsAlong = (mirrorCell, side, d) => {
        let k = mirrorCell;
        for (let c = 0; c < d; c++) k = cellOnSide(walkGrid, k, side);
        return k;
    };
    const addHops = (mirrorCell, heroSide, landSide, onLily) => {
        const other = scanOtherArm(mirrorCell, landSide);
        for (
            let distance = 1, k = mirrorCell, cell = cellOnSide(walkGrid, mirrorCell, heroSide);
            distance <= rayLength && distance < other.target;
            distance++, k = cell, cell = cellOnSide(walkGrid, cell, heroSide)
        ) {
            if (fenced(walkGrid, k, heroSide, cell) || stopsRay(cell) || isTarget(cell)) break;
            if (distance >= other.stop || distance >= other.fence) break;
            addTo(hopsByCell, cell, cellsAlong(mirrorCell, landSide, distance));
            if (onLily) drifting.add(cell);
        }
    };
    const mirrors = [];
    for (const [pid, i, j, z, ax, ay, bx, by, vertical, freezer, ex] of walkGrid.world.magic_mirrors || []) {
        const mirrorCell = latestCell(walkGrid, pid, i, j, z);
        if (mirrorCell < 0 || !exists(walkGrid, pid, ex)) continue;
        if (freezer && freezerOf.has(freezer) && closedFreezers[freezerOf.get(freezer)]) continue;
        mirrors.push({ mirrorCell, vertical, arms: [sideOf(ax, ay), sideOf(bx, by)] });
    }
    const perRoom = new Map();
    for (const { mirrorCell } of mirrors) {
        const room = roomOf(walkGrid, mirrorCell);
        perRoom.set(room, (perRoom.get(room) || 0) + 1);
    }
    for (const { mirrorCell, vertical, arms } of mirrors) {
        if (vertical || perRoom.get(roomOf(walkGrid, mirrorCell)) > 1) continue;
        if (Math.floor(mirrorCell / layerCells) - ZB >= boxZ || arms.includes(-1)) continue;
        const onLily = lilyCells.has(mirrorCell);
        addHops(mirrorCell, arms[0], arms[1], onLily);
        addHops(mirrorCell, arms[1], arms[0], onLily);
    }
    return { hops: hopsByCell, driftHops: drifting };
}
