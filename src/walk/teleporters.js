// Teleporter states, the pads of a walker's grid and where they send the hero, and the pads a discovery reveals
// (MOVEMENT.md "Teleporter pads and fast travel", STATE.md "Teleporters in the save", VIEWER.md "Pads revealed through
// the map rooms")
import { PROG } from '../data.js';
import { latestF32, latestFlag } from '../save.js';
import { addTo, cellOf, FIRE, ZB } from './cells.js';
import { exists } from './groups.js';
import { deep, layerOf } from './ocean.js';
import { push } from './queue.js';
import { PROTECTED } from './skills.js';
import { blocked, land, standable } from './support.js';

export function teleporterStatesOf(latest) {
    return (PROG.teleporters || []).map((t) => ({
        en: latestF32(latest, t.pid, 'enabled_t_target', +!!t.en) > 0,
        disc: latestFlag(latest, t.pid, 'discovered', t.disc),
    }));
}
// Per teleporter, the indices of the other world-layer (0-2) pads its discovery reveals. Discovering a pad discovers
// its target_id, then its also_discover pad, each with its own chain (a pad discovered already ends it), then its
// also_discover2 pad alone (no chain).
export function reveals(teleporters) {
    const indexOfPid = new Map(teleporters.map((t, i) => [t.pid, i]));
    return teleporters.map((t0, origin) => {
        const out = new Set(),
            discover = (i) => {
                if (i === undefined || out.has(i)) return;
                out.add(i);
                discover(indexOfPid.get(teleporters[i].target));
                discover(indexOfPid.get(teleporters[i].also));
                const a2 = indexOfPid.get(teleporters[i].also2);
                if (a2 !== undefined) out.add(a2);
            };
        discover(origin);
        return [...out].filter((i) => i !== origin && teleporters[i].l < 3).toSorted((a, b) => a - b);
    });
}
export function placePads(walkGrid) {
    const { teleporters: T, teleporterStates: tst } = walkGrid;
    T.forEach((t, ti) => {
        if (exists(walkGrid, t.pid, t.ex)) addTo(walkGrid.padsAt, cellOf(walkGrid, ...t.p), ti);
    });
    walkGrid.majorPads = T.map((t, i) => i).filter(
        (i) => T[i].major && tst[i].en && tst[i].disc && exists(walkGrid, T[i].pid, T[i].ex),
    );
}
// the cell a hero arriving by teleporter ti stands in
export function padCell(walkGrid, floodState, ti) {
    return land(walkGrid, floodState, cellOf(walkGrid, ...walkGrid.teleporters[ti].p));
}
// the cell a pad sends a hero (layer `layer`) to at world point `point` (a Marker) stands in: the first supported cell
// at or below it inside its ground layer (falls have no limit), none inside a wall, in water deeper than 0.1 or in an
// attacked cell the hero has no PROTECTION for
function dropCell(walkGrid, floodState, point, layer) {
    const markerCell = cellOf(walkGrid, ...point);
    if (markerCell < 0) return -1;
    const layerCells = walkGrid.layerCells,
        groundLayer = layerOf(walkGrid, Math.floor(markerCell / layerCells) - ZB);
    for (
        let cell = markerCell;
        cell >= layerCells && layerOf(walkGrid, Math.floor(cell / layerCells) - ZB) === groundLayer;
        cell -= layerCells
    ) {
        if (blocked(walkGrid, floodState, cell)) return -1;
        if (walkGrid.cellFlags[cell] & FIRE) {
            if (layer === PROTECTED) return cell;
            return -1;
        }
        if (deep(walkGrid, cell)) return -1;
        if (standable(walkGrid, floodState, cell)) return cell;
    }
    return -1;
}
// a pad keeps the hero's skill: on the overworld only Wardrobe doors change it
export function padStep(walkGrid, floodState, cell, layer) {
    const { padsAt, teleporters, teleporterStates, teleporterIndex, layerCells } = walkGrid;
    for (let pc = cell, n = 0; n < 2; n++, pc -= layerCells) {
        const pads = padsAt.get(pc);
        if (!pads) continue;
        for (const ti of pads) {
            if (!teleporterStates[ti].en) continue;
            if (floodState.reveal)
                for (const r of walkGrid.revealedPads[ti])
                    push(walkGrid, floodState, padCell(walkGrid, floodState, r), layer);
            if (teleporters[ti].major) {
                if (teleporterStates[ti].disc && !floodState.majorDone[layer]) {
                    floodState.majorDone[layer] = true;
                    for (const m of walkGrid.majorPads)
                        push(walkGrid, floodState, padCell(walkGrid, floodState, m), layer);
                }
            } else if (teleporterIndex.has(teleporters[ti].target)) {
                const target = teleporterIndex.get(teleporters[ti].target);
                push(walkGrid, floodState, padCell(walkGrid, floodState, target), layer);
            } else if (teleporters[ti].to)
                push(walkGrid, floodState, dropCell(walkGrid, floodState, teleporters[ti].to, layer), layer);
        }
    }
}
