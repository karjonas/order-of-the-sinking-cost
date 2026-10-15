// Magic Mirrors pushed with turns: a Mirror the walk pushes to another cell hops from there (MOVEMENT.md "Magic
// mirrors", VIEWER.md "Moves", "Magic-mirror hops")
import { roomOf } from './beams.ts';
import { MOVABLE, TRAVEL_MARK, Z_BIAS } from './cells.ts';
import type { FloodState } from './flood.ts';
import { missChanged, PRESS_CELLS, pressInputs } from './gates.ts';
import type { PressMiss } from './gates.ts';
import { armHops, magicMirrorsOf, mirrorsPerRoom } from './mirror-isles.ts';
import { settle, visitReached } from './queue.ts';
import { pushLandings } from './rock-turns.ts';
import { LAYER_COUNT } from './skills.ts';
import { blocked } from './support.ts';
import type { WalkGrid } from './walker.ts';

/**
 * A flat magic Mirror the hero may push: the cell the save last left it in, the sides of its two open arms and its
 * room. `roomCounts`: how many magic Mirrors, vertical ones too, stand in each room.
 */
export interface MirrorTurn {
    cell: number;
    arms: [first: number, second: number];
    room: string;
    roomCounts: Map<string, number>;
}

/**
 * The magic Mirrors whose pushes may turn: the flat ones below the map rooms that are pushable and do not ride a Lily,
 * in the order of the level data.
 */
export function mirrorTurnsOf(walkGrid: WalkGrid): MirrorTurn[] {
    const { grid, layerCells, boxZ, lilyCells } = walkGrid;
    const mirrors = magicMirrorsOf(walkGrid);
    const roomCounts = mirrorsPerRoom(walkGrid, mirrors);
    const turns: MirrorTurn[] = [];

    for (const { mirrorCell, vertical, arms } of mirrors) {
        const [firstArm, secondArm] = arms;
        const mirrorZ = Math.floor(mirrorCell / layerCells) - Z_BIAS;
        if (vertical || firstArm < 0 || secondArm < 0 || mirrorZ >= boxZ) continue;
        if (!(grid[mirrorCell] & MOVABLE) || lilyCells.has(mirrorCell)) continue;

        turns.push({ cell: mirrorCell, arms, room: roomOf(walkGrid, mirrorCell), roomCounts });
    }

    return turns;
}

/**
 * The cells a Mirror in `mirrorCell` is pushed to, as a Rock is in bridgeOf: nearest first over at most PRESS_CELLS
 * cells, by a hero who stands in a cell the flood reached in layer 0. A push that sinks the Mirror in water ends it
 * there. The push cells turned down go to `miss`.
 */
function positionsOf(walkGrid: WalkGrid, floodState: FloodState, mirrorCell: number, miss: PressMiss): number[] {
    const positions = [mirrorCell];
    const seen = new Set(positions);

    for (let index = 0; index < positions.length && index < PRESS_CELLS; index++) {
        pushLandings(walkGrid, floodState, positions[index], miss, (landing) => {
            if (landing.sinks || seen.has(landing.cell)) return;

            seen.add(landing.cell);
            positions.push(landing.cell);
        });
    }

    return positions;
}

/**
 * Notes the hop from `armCell` to `landing` for the rest of the flood, and walks on from `landing` in each walk layer
 * the flood reached `armCell` in. Returns whether the hop is new.
 */
function noteHop(walkGrid: WalkGrid, floodState: FloodState, armCell: number, landing: number): boolean {
    const { hopsAt, hopMarked } = floodState;
    const known = hopsAt.get(armCell);
    if (known?.includes(landing)) return false;

    if (known) {
        known.push(landing);
    } else {
        hopsAt.set(armCell, [landing]);
    }

    if (!(walkGrid.marks[armCell] & TRAVEL_MARK)) {
        walkGrid.marks[armCell] |= TRAVEL_MARK;
        hopMarked.push(armCell);
    }

    if (blocked(walkGrid, floodState, landing)) return true;

    const armZ = Math.floor(armCell / walkGrid.layerCells) - Z_BIAS;

    for (let layer = 0; layer < LAYER_COUNT; layer++) {
        if (walkGrid.visited[armCell] & (1 << layer)) settle(walkGrid, floodState, landing, armZ, layer);
    }

    return true;
}

/**
 * Notes the hops of the Mirror of `turn` standing in `position`, a cell other than its own, when no other magic Mirror
 * stands in the room of `position`. A hero hops only from an arm cell in that room, since the game handles a mirage
 * only while the Mirror's room holds a Guy. Returns whether any hop is new.
 */
function noteHopsFrom(walkGrid: WalkGrid, floodState: FloodState, turn: MirrorTurn, position: number): boolean {
    const room = roomOf(walkGrid, position);
    let rivals = turn.roomCounts.get(room) ?? 0;
    if (room === turn.room) rivals--;
    if (rivals > 0) return false;

    let added = false;

    const noteArmHop = (armCell: number, landing: number): void => {
        if (roomOf(walkGrid, armCell) !== room) return;
        if (noteHop(walkGrid, floodState, armCell, landing)) added = true;
    };

    const [firstArm, secondArm] = turn.arms;
    armHops(walkGrid, position, firstArm, secondArm, null, turn.cell, noteArmHop);
    armHops(walkGrid, position, secondArm, firstArm, null, turn.cell, noteArmHop);

    return added;
}

/**
 * Hops off the magic Mirrors the walk pushes with turns, once a hero reaches a cell beside one: every cell the Mirror
 * can be pushed to is a place it hops from, the hops of each laid as for a Mirror standing there (the cell it left
 * ends no ray). The hops hold for the rest of the flood, wherever the hero is when he reaches an arm. A Mirror whose
 * search is done is looked at again only once what it reads has changed. Returns whether any hop is new.
 */
export function hopTurned(walkGrid: WalkGrid, floodState: FloodState): boolean {
    const { triggers } = walkGrid;
    const { mirrorSeen, mirrorsDue, mirrorMisses } = floodState;

    visitReached(floodState, floodState.mirrorCursor, (cell, layer) => {
        if (layer !== 0) return;

        for (const mirrorIndex of triggers.mirrorTurnsAt.get(cell) || []) {
            if (mirrorSeen[mirrorIndex]) continue;

            mirrorSeen[mirrorIndex] = 1;
            mirrorsDue.push(mirrorIndex);
        }
    });

    let hopped = false;

    for (const mirrorIndex of mirrorsDue) {
        const miss = mirrorMisses[mirrorIndex];
        if (miss && !missChanged(walkGrid, floodState, miss)) continue;

        const turn = triggers.mirrorTurns[mirrorIndex];
        const newMiss: PressMiss = { inputs: pressInputs(floodState), pushCells: [], wallStops: [] };
        const positions = positionsOf(walkGrid, floodState, turn.cell, newMiss);
        mirrorMisses[mirrorIndex] = newMiss;

        for (let index = 1; index < positions.length; index++) {
            if (noteHopsFrom(walkGrid, floodState, turn, positions[index])) hopped = true;
        }
    }

    return hopped;
}
