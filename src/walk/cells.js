// Cell keys and their neighbours, sides and the per-cell bits of a walker's grid (WORLD.md "Positions and cells",
// "Wrapping", "Map rooms")
import { PROG } from '../data.js';

export const mod = (value, modulus) => ((value % modulus) + modulus) % modulus;
// a side (0 east, 1 north, 2 west, 3 south) as a step [dx, dy]; the flood takes the sides in SIDES order
export const STEP = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
];
export const SIDES = [0, 2, 1, 3];
// a cell key's z layer is z + ZB
export const ZB = 80;
export const DIRS = SIDES.map((s) => STEP[s]);
// per cell of a walker's grid: solid; supports the cell above (solid or a rock); holds the hero in its own cell (a lily or
// a floor); a shut Gate; then what stands there: a Rock, a living Monster, a movable, a beam stop (Trees, Signs,
// Treasure_Displays, Judges, the level data's beam stops, and the Rocks and movables other than MIRRORABLE Rocks and
// mirrorable Rovers)
export const SOLID = 1,
    SUPPORT = 2,
    FLOOR = 4,
    GATE = 8,
    ROCK = 16,
    MONSTER = 32,
    MOVABLE = 64,
    BEAMSTOP = 128,
    // fire runs until a solid voxel or rock, a shut Gate, a Monster or a movable; a goblin attacks a movable's cell
    FIRE_STOP = SOLID | SUPPORT | GATE | MONSTER | MOVABLE,
    GOBLIN_STOP = SOLID | SUPPORT | GATE | MONSTER,
    // a beam runs through walls, Guys, Monsters, MIRRORABLE Rocks and mirrorable Rovers
    BEAM_STOP = GATE | BEAMSTOP,
    // what the hero pushes (SINGLE_PUSH)
    PUSH = ROCK | MONSTER | MOVABLE;
// per cell, next to the grid: the fence sides (bit per side), an attacked cell, a THROUGH beam's wall cell, a THROUGH beam
export const FIRE = 16,
    THRU = 32,
    BEAM = 64;
// appends `value` to the list of `key` in `map`
export const addTo = (map, key, value) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
};
// the map column (row 0 = north, as in the layer images) of world square x, y, and of a grid column and row
export const mapCol = (x, y) => {
    const [mw, mh] = PROG.map.size,
        [mx, my] = PROG.map.corner;
    return (mh - 1 - mod(y - my, mh)) * mw + mod(x - mx, mw);
};
export const gridCol = (column, row) => mapCol(PROG.world.grid.corner[0] + column, PROG.world.grid.corner[1] + row);

// the column offset in a z layer of the cell `columns` columns and `rows` rows from the box corner, wrapped inside the
// box
function inBox(walkGrid, columns, rows) {
    const { boxColumn, boxRow, boxWidth, boxHeight, width, height } = walkGrid;
    return mod(boxColumn + mod(columns, boxWidth), width) + mod(boxRow + mod(rows, boxHeight), height) * width;
}
// cell key = (z + ZB) * width * height + row * width + column
export function cellOf(walkGrid, x, y, z) {
    const layer = Math.round(z);
    if (layer < 1 - ZB || layer >= walkGrid.layerCount - ZB - 1) return -1;
    const { width, height, layerCells, boxZ, boxColumn, boxRow } = walkGrid;
    const column = Math.round(x) - walkGrid.cornerX,
        row = Math.round(y) - walkGrid.cornerY;
    if (layer >= boxZ) return (layer + ZB) * layerCells + inBox(walkGrid, column - boxColumn, row - boxRow);
    return (layer + ZB) * layerCells + (mod(column, width) + mod(row, height) * width);
}
// the cell dx, dy (each -1..1) away from `cell` in the same z
export function neighbourOf(walkGrid, cell, dx, dy) {
    const { width, height } = walkGrid;
    const column = cell % width,
        row = Math.floor(cell / width) % height,
        layerStart = cell - column - row * width;
    if (layerStart / walkGrid.layerCells - ZB >= walkGrid.boxZ) {
        const boxColumn = mod(column - walkGrid.boxColumn, width),
            boxRow = mod(row - walkGrid.boxRow, height);
        if (boxColumn < walkGrid.boxWidth && boxRow < walkGrid.boxHeight)
            return layerStart + inBox(walkGrid, boxColumn + dx, boxRow + dy);
    }
    return layerStart + mod(column + dx, width) + mod(row + dy, height) * width;
}
export function keyOf(walkGrid, column, row, z) {
    if (z < 1 - ZB || z >= walkGrid.layerCount - ZB - 1) return -1;
    return (z + ZB) * walkGrid.layerCells + row * walkGrid.width + column;
}
// the cell next to `cell` on side `side`
export function cellOnSide(walkGrid, cell, side) {
    return neighbourOf(walkGrid, cell, STEP[side][0], STEP[side][1]);
}
