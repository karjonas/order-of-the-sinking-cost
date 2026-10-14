// Elevators (MOVEMENT.md "Elevators")
import { addTo, FLOOR, keyOf } from './cells.js';
import { exists } from './groups.js';

// elevators: stepping onto the platform at one frame rides it to the other (mask bit 1 up from the bottom, bit 2
// down from the top); the platform holds the hero in both frame cells
export function placeElevators(walkGrid) {
    const { grid, elevatorsAt } = walkGrid;
    for (const [i, j, z, i2, j2, z2, mask, pb, eb, pt, et] of walkGrid.world.elevators || []) {
        const bottom = keyOf(walkGrid, i, j, z),
            top = keyOf(walkGrid, i2, j2, z2);
        if (!mask || bottom < 0 || top < 0) continue;
        if (!exists(walkGrid, pb, eb < 0 ? undefined : eb) || !exists(walkGrid, pt, et < 0 ? undefined : et)) continue;
        grid[bottom] |= FLOOR;
        grid[top] |= FLOOR;
        if (mask & 1) addTo(elevatorsAt, bottom, top);
        if (mask & 2) addTo(elevatorsAt, top, bottom);
    }
}
