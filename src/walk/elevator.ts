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
 * An elevator that rides, in the level data: its two frame cells, which way it rides (RIDES_UP, RIDES_DOWN bits) and
 * the pid and level-data existence of each frame (undefined: the frame has no `exists` entry).
 */
export interface ElevatorFrames {
    bottom: number;
    top: number;
    mask: number;
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
        const [bottomI, bottomJ, bottomZ, topI, topJ, topZ, mask, bottomPid, bottomExistence, topPid, topExistence] =
            elevator;
        const bottom = keyOf(shape, bottomI, bottomJ, bottomZ);
        const top = keyOf(shape, topI, topJ, topZ);
        if (!mask || bottom < 0 || top < 0) continue;

        elevators.push({
            bottom,
            top,
            mask,
            bottomPid,
            bottomExistence: frameExistence(bottomExistence),
            topPid,
            topExistence: frameExistence(topExistence),
        });
    }

    return elevators;
}

/**
 * Places the elevators: stepping onto the platform at one frame rides it to the other (RIDES_UP from the bottom,
 * RIDES_DOWN from the top); the platform holds the hero in both frame cells.
 */
export function placeElevators(walkGrid: WalkGrid): void {
    const { grid, elevatorsAt } = walkGrid;

    for (const elevator of walkGrid.geometry.elevators) {
        const { bottom, top, mask } = elevator;
        if (!exists(walkGrid, elevator.bottomPid, elevator.bottomExistence)) continue;
        if (!exists(walkGrid, elevator.topPid, elevator.topExistence)) continue;

        grid[bottom] |= FLOOR;
        grid[top] |= FLOOR;

        if (mask & RIDES_UP) addTo(elevatorsAt, bottom, top);
        if (mask & RIDES_DOWN) addTo(elevatorsAt, top, bottom);
    }
}
