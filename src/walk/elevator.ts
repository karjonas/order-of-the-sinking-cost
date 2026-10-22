// Elevators (MOVEMENT.md "Elevators")
import type { World } from '../types.ts';
import { addTo, FLOOR, keyOf } from './cells.ts';
import type { GridShape } from './cells.ts';
import { exists } from './groups.ts';
import type { WalkGrid } from './walker.ts';

// Elevator mask bits: rides up from the bottom frame, rides down from the top frame
const RIDES_UP = 1;
const RIDES_DOWN = 2;

/**
 * An elevator that rides, in the level data: its two frame cells, which way it rides (RIDES_UP, RIDES_DOWN bits) with
 * no Rock on its platform and with one Rock left of the `stack` Rocks resting on it (bottom first), and the pid and
 * level-data existence of each frame (undefined: the frame has no `exists` entry).
 */
export interface ElevatorFrames {
    bottom: number;
    top: number;
    mask: number;
    oneRockMask: number;
    stack: number[];
    bottomPid: number;
    bottomExistence: number | undefined;
    topPid: number;
    topExistence: number | undefined;
}

/** An elevator frame's level-data existence: -1 means the frame has no `exists` entry. */
function frameExistence(existence: number): number | undefined {
    if (existence < 0) return undefined;
    return existence;
}

/** The elevators of the level data that ride between two cells inside the grid, in list order. */
export function levelElevators(shape: GridShape, world: World): ElevatorFrames[] {
    const elevators: ElevatorFrames[] = [];

    for (const elevator of world.elevators || []) {
        const [
            bottomI,
            bottomJ,
            bottomZ,
            topI,
            topJ,
            topZ,
            mask,
            bottomPid,
            bottomExistence,
            topPid,
            topExistence,
            oneRockMask = mask,
            stack = [],
        ] = elevator;
        const bottom = keyOf(shape, bottomI, bottomJ, bottomZ);
        const top = keyOf(shape, topI, topJ, topZ);
        if (!mask || bottom < 0 || top < 0) continue;

        elevators.push({
            bottom,
            top,
            mask,
            oneRockMask,
            stack,
            bottomPid,
            bottomExistence: frameExistence(bottomExistence),
            topPid,
            topExistence: frameExistence(topExistence),
        });
    }

    return elevators;
}

/**
 * Which way an elevator rides, by how many of its stacked Rocks are still at their level-data cells: none rides by
 * `mask`, one by `oneRockMask`, two or more are not one push and ride nowhere.
 */
function rideMask(elevator: ElevatorFrames, unmovedRocks: Set<number>): number {
    let left = 0;
    for (const pid of elevator.stack) {
        if (unmovedRocks.has(pid)) left++;
    }

    if (left === 0) return elevator.mask;
    if (left === 1) return elevator.oneRockMask;
    return 0;
}

/**
 * Places the elevators: stepping onto the platform at one frame rides it to the other (RIDES_UP from the bottom,
 * RIDES_DOWN from the top); the platform holds the hero in both frame cells. `unmovedRocks`: the existing Rocks still
 * at their level-data cell.
 */
export function placeElevators(walkGrid: WalkGrid, unmovedRocks: Set<number>): void {
    const { grid, elevatorsAt } = walkGrid;

    for (const elevator of walkGrid.geometry.elevators) {
        const { bottom, top } = elevator;
        if (!exists(walkGrid, elevator.bottomPid, elevator.bottomExistence)) continue;
        if (!exists(walkGrid, elevator.topPid, elevator.topExistence)) continue;

        const mask = rideMask(elevator, unmovedRocks);
        if (!mask) continue;

        grid[bottom] |= FLOOR;
        grid[top] |= FLOOR;

        if (mask & RIDES_UP) addTo(elevatorsAt, bottom, top);
        if (mask & RIDES_DOWN) addTo(elevatorsAt, top, bottom);
    }
}
