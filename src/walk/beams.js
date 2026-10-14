// Promesst lights, the Gem_Slots that power them, their beams and where an ENDPOINT move lands (MOVEMENT.md
// "Promesst beams and powers", VIEWER.md "Beams")
import { rawU32 } from '../save.js';
import { addTo, cellOnSide, BEAM, BEAM_STOP, keyOf, SOLID, THRU, ZB } from './cells.js';
import { dormantGroup, exists, existsNow, put } from './groups.js';
import { layerOf } from './ocean.js';
import { latestCell } from './walls.js';

// Promesst_Power (a Promesst_Light's color)
export const [OPEN, THROUGH, DOUBLE, ENDPOINT, ALTER, SQUEEZE] = [0, 1, 3, 5, 7, 9];
// the world.json movables kind of a Gem; Gem_Slot.flags BEAM_POWERED
export const GEM_KIND = 0,
    BEAM_POWERED = 2;
// Where an ENDPOINT move from cell `index` of a beam's cells lands: along the beam its last cell, against it its
// first; in an ALTER beam the midpoint of the way to that end. A move along a beam at infinity, with or without
// ALTER, takes the hero off the map, where the hero is destroyed: -1, no landing.
export function endpointTarget(beam, along, altered) {
    const { cells, index, atInfinity } = beam;
    if (along && atInfinity) return -1;
    if (!altered) return along ? cells.at(-1) : cells[0];
    if (!along) return cells[Math.floor(index / 2)];
    return cells[index + Math.ceil((cells.length - 1 - index) / 2)];
}
// A room is a 19 x 13 screen of a ground, underworld or sky layer, or a whole map-room layer.
export function roomOf(walkGrid, cell) {
    const layer = layerOf(walkGrid, Math.floor(cell / walkGrid.layerCells) - ZB);
    if (layer >= 3) return `${layer}`;
    const column = cell % walkGrid.width,
        row = Math.floor(cell / walkGrid.width) % walkGrid.height;
    return `${Math.floor(column / 19)},${Math.floor(row / 13)},${layer}`;
}
// the cells of a beam from the light's cell `lightCell` along side `side`, or up / down (dz). Solid voxels never stop a
// beam, so a vertical one leaves its layer: one that starts below the map rooms climbs no higher than half a cell under
// them. A beam runs one full lap at most (beamSteps). atInfinity: the beam ends because its next cell would leave the
// level volume (below or above the grid, or past that cap). The grid wraps in x and y, so only a vertical beam ends at
// infinity.
function beamCells(walkGrid, lightCell, side, dz) {
    const { grid, frozen, layerCells, boxZ } = walkGrid;
    const beamSteps = walkGrid.width + walkGrid.height,
        cells = [],
        lightZ = Math.floor(lightCell / layerCells) - ZB,
        top = lightZ < boxZ ? boxZ - 0.5 : Infinity;
    for (let cell = lightCell, count = beamSteps; count > 0; count--) {
        let next = 0;
        if (dz) next = cell + dz;
        else next = cellOnSide(walkGrid, cell, side);
        if (next < layerCells || next >= grid.length || Math.floor(next / layerCells) - ZB >= top)
            return { cells, atInfinity: true };
        if (next === lightCell || grid[next] & BEAM_STOP || frozen.has(next)) break;
        cells.push(next);
        cell = next;
    }
    return { cells, atInfinity: false };
}
// A room's lights are powered when it has an existing Gem_Slot and every existing one is filled: a free Gem stands in
// its cell (attached_to_entity_id 0) or its `flags` hold BEAM_POWERED.
export function placeGems(walkGrid) {
    const { world, latest, slotsByRoom, gemsAt } = walkGrid,
        heldGems = new Set(world.held_gems || []);
    for (const [pid, i, j, z, beamPowered, existence] of world.gem_slots || []) {
        const slotCell = keyOf(walkGrid, i, j, z);
        if (slotCell < 0) continue;
        const flags = latest.get(pid, 'flags');
        addTo(slotsByRoom, roomOf(walkGrid, slotCell), {
            pid,
            ex: existence,
            k: slotCell,
            beamPowered: flags ? (flags[0] & BEAM_POWERED) !== 0 : !!beamPowered,
        });
    }
    for (const [pid, i, j, z, kind, ex] of world.movables || []) {
        if (kind !== GEM_KIND) continue;
        const holder = latest.get(pid, 'attached_to_entity_id');
        const free = holder ? rawU32(holder) === 0 : !heldGems.has(pid);
        const cell = latestCell(walkGrid, pid, i, j, z);
        if (free && cell >= 0) addTo(gemsAt, cell, { pid, ex });
    }
}
function slotFilled(walkGrid, slot, isThere) {
    if (slot.beamPowered) return true;
    return (walkGrid.gemsAt.get(slot.k) || []).some((gem) => isThere(gem.pid, gem.ex));
}
function roomPowered(walkGrid, room, isThere) {
    const counted = (walkGrid.slotsByRoom.get(room) || []).filter((slot) => isThere(slot.pid, slot.ex));
    return counted.length > 0 && counted.every((slot) => slotFilled(walkGrid, slot, isThere));
}
// the Groups that keep a Gem_Slot of the room, or a Gem on one, from existing
function roomGroups(walkGrid, room) {
    const out = [];
    for (const slot of walkGrid.slotsByRoom.get(room) || []) {
        out.push(dormantGroup(walkGrid, slot.pid, slot.ex));
        for (const gem of walkGrid.gemsAt.get(slot.k) || []) out.push(dormantGroup(walkGrid, gem.pid, gem.ex));
    }
    return out;
}
// a horizontal THROUGH light that only the Groups withGroups makes exist power (the light, or a Gem_Slot or Gem in its
// room, is a member) lets the hero through the walls in its beam while they exist
function castDormantThrough(walkGrid, pid, i, j, z, side, ex) {
    const lightCell = latestCell(walkGrid, pid, i, j, z);
    const existsWithGroups = (id, idEx) => existsNow(walkGrid, id, idEx);
    if (lightCell < 0 || walkGrid.frozen.has(lightCell) || !existsNow(walkGrid, pid, ex)) return;
    if (!roomPowered(walkGrid, roomOf(walkGrid, lightCell), existsWithGroups)) return;
    for (const n of beamCells(walkGrid, lightCell, side, 0).cells) {
        put(walkGrid, walkGrid.cellFlags, n, BEAM);
        if (walkGrid.grid[n] & SOLID) put(walkGrid, walkGrid.cellFlags, n, THRU);
    }
}
// the step of a vertical_up / vertical_down beam from cell to cell, else 0
function verticalStep(up, down, layerCells) {
    if (up) return layerCells;
    if (down) return -layerCells;
    return 0;
}
// A powered Promesst_Light's beam runs from the light (where the save last left it) along its facing (up or down for
// vertical_up / vertical_down, out of its layer) through walls, Guys and Monsters until a BEAM_STOP or a closed ice
// gate: until a stop, one full lap at most (beamSteps), ending at its own light. Mirror reflections are not followed. A
// horizontal THROUGH beam lets the hero walk through the walls in it. A hero standing in a beam takes its power:
// ENDPOINT (horizontal) moves along it jump to its last cell, against it to its first; DOUBLE doubles each move per
// beam; SQUEEZE passes Fences. In an ALTER beam too, each DOUBLE beam triples the move and ENDPOINT jumps to the
// midpoint (endpointTarget). A light is powered by its room (roomPowered), whatever `powered` the save stored.
export function placeLights(walkGrid) {
    const { world, grid, cellFlags, layerCells, frozen, litCells } = walkGrid;
    const existsThere = (pid, ex) => exists(walkGrid, pid, ex);
    for (const [pid, column, row, z, side, up, down, , color, existence] of world.lights || []) {
        const through = color === THROUGH;
        const lightCell = latestCell(walkGrid, pid, column, row, z);
        const dz = verticalStep(up, down, layerCells);
        const powered =
            lightCell >= 0 &&
            exists(walkGrid, pid, existence) &&
            roomPowered(walkGrid, roomOf(walkGrid, lightCell), existsThere);
        if (through && !dz && side >= 0 && lightCell >= 0 && !powered) {
            const room = roomOf(walkGrid, lightCell);
            const groups = new Set([dormantGroup(walkGrid, pid, existence), ...roomGroups(walkGrid, room)]);
            for (const groupIndex of groups)
                if (groupIndex !== undefined)
                    walkGrid.dormantLights[groupIndex].push(() =>
                        castDormantThrough(walkGrid, pid, column, row, z, side, existence),
                    );
        }
        if (lightCell < 0 || !exists(walkGrid, pid, existence) || frozen.has(lightCell)) continue;
        litCells.push(lightCell);
        if ((!dz && side < 0) || !powered) continue;
        const { cells, atInfinity } = beamCells(walkGrid, lightCell, side, dz);
        for (const cell of cells) {
            litCells.push(cell);
            if (!through || dz) continue;
            walkGrid.throughBeam.add(cell);
            cellFlags[cell] |= BEAM;
            if (grid[cell] & SOLID) {
                walkGrid.throughWalls.add(cell);
                cellFlags[cell] |= THRU;
            }
        }
        cells.forEach((cell, index) => {
            if (color === ENDPOINT && !dz) addTo(walkGrid.endpointBeams, cell, { side, cells, index, atInfinity });
            else if (color === DOUBLE) walkGrid.doubleBeams.set(cell, (walkGrid.doubleBeams.get(cell) || 0) + 1);
            else if (color === ALTER) walkGrid.alterCells.add(cell);
            else if (color === SQUEEZE) walkGrid.squeezeCells.add(cell);
            else if (color === OPEN) walkGrid.openBeamCells.add(cell);
        });
    }
}
