// Wall_Set voxels and Ocean_Map squares in world coordinates. Both are stored in the entity's local frame: the cell at
// local offset p (wall_data.corner or grid.corner plus the index within the box) is at position + R · p, where R is the
// rotation of the entity's orientation quaternion. The entity's scale is not applied.
import { get, type Fields } from './fields.ts';
import type { Vector } from './math.ts';

// The entity's local x, y and z axes in world coordinates (the columns of R)
export function localAxes(fields: Fields): [Vector, Vector, Vector] {
    const x = get(fields, 'base.orientation.x', 0);
    const y = get(fields, 'base.orientation.y', 0);
    const z = get(fields, 'base.orientation.z', 0);
    const w = get(fields, 'base.orientation.w', 1);
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
        [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
        [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
    ];
}

// Whether the entity's local x and y axes, rounded to the grid, are the world's x and y
export function isAxisAligned(fields: Fields): boolean {
    const [axisX, axisY] = localAxes(fields);
    return Math.round(axisX[0]) === 1 && Math.round(axisY[1]) === 1;
}

// The world cell (each coordinate rounded) of a local offset
function placer(fields: Fields): (offset: Vector) => Vector {
    const position = ['x', 'y', 'z'].map((axis) => get(fields, `base.position.${axis}`, 0));
    const [axisX, axisY, axisZ] = localAxes(fields);
    const round = (k: number, x: number, y: number, z: number) =>
        Math.round(position[k] + axisX[k] * x + axisY[k] * y + axisZ[k] * z);
    return ([x, y, z]) => [round(0, x, y, z), round(1, x, y, z), round(2, x, y, z)];
}

// A Wall_Set's occupied voxels as [x, y, z] world cells, in storage order: bit k of wall_data.bits.slots is the voxel
// at local (corner.x + k % width, corner.y + floor(k / width) % depth, corner.z + floor(k / (width * depth)))
export function wallVoxels(fields: Fields): Vector[] {
    const corner = ['x', 'y', 'z'].map((axis) => get(fields, `wall_data.corner.${axis}`, 0));
    const [width, depth, height] = ['x', 'y', 'z'].map((axis) => get(fields, `wall_data.dimensions.${axis}`, 0));
    const storedSlots = fields['wall_data.bits.slots'] ?? [];
    const slots: bigint[] = Array.isArray(storedSlots) ? storedSlots.map(BigInt) : [];
    const place = placer(fields);
    const voxels: Vector[] = [];
    const total = width * depth * height;
    for (let k = 0; k < total; k++) {
        const word = k >> 6;
        if (word >= slots.length) break;
        if (((slots[word] >> BigInt(k & 63)) & 1n) === 0n) continue;
        voxels.push(
            place([
                corner[0] + (k % width),
                corner[1] + (Math.floor(k / width) % depth),
                corner[2] + Math.floor(k / (width * depth)),
            ]),
        );
    }
    return voxels;
}

// An Ocean_Map's squares as [x, y] world cells: square k (ocean_values[k]) is at local
// (corner.x + k % squares_x, corner.y + floor(k / squares_x))
export function oceanSquares(fields: Fields): [number, number][] {
    const cornerX = get(fields, 'grid.corner.x', 0);
    const cornerY = get(fields, 'grid.corner.y', 0);
    const squaresX = get(fields, 'grid.squares_x', 0);
    const squaresY = get(fields, 'grid.squares_y', 0);
    const place = placer(fields);
    const squares: [number, number][] = [];
    for (let k = 0; k < squaresX * squaresY; k++) {
        const [x, y] = place([cornerX + (k % squaresX), cornerY + Math.floor(k / squaresX), 0]);
        squares.push([x, y]);
    }
    return squares;
}
