// The flood's queue: how a flood records the cells it reaches, the fall onto a supported cell, and how it walks on
// from the cells it reached (VIEWER.md "Moves", MOVEMENT.md "Falling")
import { DIRS, FIRE, neighbourOf } from './cells.js';
import { layerOf, waterAt } from './ocean.js';
import { PROTECTED, WIZARD } from './skills.js';
import { blocked, standable } from './support.js';

// the flood reaches `cell` in walk layer `layer`: once per layer, never `outside`; it is queued and, on a trigger
// cell, noted in triggerHits
export function push(walkGrid, floodState, cell, layer) {
    const bit = 1 << layer,
        visited = walkGrid.visited;
    if (cell >= 0 && !(visited[cell] & bit) && !floodState.outside?.has(cell)) {
        visited[cell] |= bit;
        floodState.reached[layer].push(cell);
        if (walkGrid.triggers.cells[cell]) floodState.triggerHits.push(cell, layer);
        floodState.queue.push(cell, layer);
    }
}
// whether a fall from height z down to fallZ stays where the flood may go: a fall that starts in a map room lands
// inside that room or nowhere, and a pocket flood keeps every fall inside the layer it starts in
function fallStaysIn(walkGrid, floodState, startLayer, z, fallZ) {
    if (z < walkGrid.boxZ && !floodState.pocket) return true;
    return layerOf(walkGrid, fallZ) === startLayer;
}
// The hero (layer `layer`) arriving at `cell` from height z lands on the first supported cell at or below it, however
// far down; a move into water needs that support within 0.1 below the surface (a jump into water lands at the surface
// - 1 and drowns); a floor holds the hero, and an attacked cell a hero with PROTECTION. A fall that starts in a map room
// lands inside that room or nowhere (the room's implicit floor holds the hero; its height is not modelled). A pocket
// flood keeps every fall inside the layer it starts in: a fall into a lower layer is not walked back, so what lies
// below is no part of the pocket.
export function settle(walkGrid, floodState, cell, z, layer) {
    const { cellFlags, layerCells } = walkGrid;
    const startLayer = layerOf(walkGrid, z);
    for (let drop = 0, fallCell = cell; fallCell >= 0; drop++, fallCell -= layerCells) {
        if (!fallStaysIn(walkGrid, floodState, startLayer, z, z - drop)) return;
        if (drop && blocked(walkGrid, floodState, fallCell)) return;
        // fire and goblin attacks kill a hero without PROTECTION
        if (cellFlags[fallCell] & FIRE) {
            if (layer === PROTECTED) push(walkGrid, floodState, fallCell, layer);
            return;
        }
        const wz = waterAt(walkGrid, fallCell % layerCells, z - drop);
        if (wz != null && z - drop < wz - 0.1) return;
        if (standable(walkGrid, floodState, fallCell)) {
            push(walkGrid, floodState, fallCell, layer);
            return;
        }
    }
}
// walk on from the reached cells next to the column of `columnCell`, at its height and above, up to the first cell
// over it that a hero stepping in from the side would stop in or bump into
export function requeue(walkGrid, floodState, columnCell) {
    const { grid, layerCells, visited } = walkGrid,
        queue = floodState.queue;
    for (const [dx, dy] of DIRS)
        for (
            let besideCell = neighbourOf(walkGrid, columnCell, dx, dy), over = columnCell;
            besideCell < grid.length;
            besideCell += layerCells, over += layerCells
        ) {
            if (over !== columnCell && (blocked(walkGrid, floodState, over) || standable(walkGrid, floodState, over)))
                break;
            for (let p = 0; p <= WIZARD; p++) if (visited[besideCell] & (1 << p)) queue.push(besideCell, p);
        }
}
// calls visit(cell, layer) for each trigger cell reached in a walk layer since cursor.at (the triggerHits already visited), and
// moves the cursor on
export function visitReached(floodState, cursor, visit) {
    const triggerHits = floodState.triggerHits;
    for (; cursor.at < triggerHits.length; cursor.at += 2) visit(triggerHits[cursor.at], triggerHits[cursor.at + 1]);
}
