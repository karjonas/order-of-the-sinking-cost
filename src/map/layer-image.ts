// The base image of one map layer (DATAFILES.md "The viewer's base image"): every square's kind and colour from the
// map's colour and height grid (DATAFILES.md "The colour and height grid (map.json)"), the level data and the walk's
// floor heights, painted MAP_SCALE pixels per square; and the squares an OCEAN_CHANGE turned into water
import { fromBase64, PROG, WORLD } from '../data.ts';
import type { Fog } from '../fog.ts';
import type { LatestValues } from '../save.ts';
import type { MapLayer } from '../types.ts';
import { gridCol, mapCol } from '../walk/cells.ts';
import { FLOOR_HEIGHTS } from '../walk-data.ts';
import { FOG_RGB, oklab, oklabRgb } from './colors.ts';
import type { Rgb } from './colors.ts';

/** The squares of each map layer that a change turned into water, as world (x, y) per square. */
export type OceanSquares = Record<string, Array<[x: number, y: number]>>;

/** The colours the water squares are painted with. */
interface WaterPalette {
    deep: Rgb;
    deepLab: [lightness: number, a: number, b: number];
    shallow: Rgb;
    river: Rgb;
    riverEdge: Rgb;
}

/** What painting a layer's squares reads. */
interface LayerImage {
    width: number;
    height: number;
    kinds: Uint8Array;
    marks: Uint8Array;
    floorHeights: Float32Array | undefined;
    palette: WaterPalette;
    fences: Uint8Array;
    smooth: Float32Array;
}

/** What painting one square reads. */
interface SquarePaint {
    kind: number;
    fill: Rgb;
    rock: boolean;
    /** Per side (west, east, north, south): the colour of its edge line, or false for none. */
    lines: Array<Rgb | false>;
    /** Per side (west, east, north, south): whether a fence stands there. */
    fences: boolean[];
    under: Rgb;
}

/** What decides a square's kind. */
interface SquareFacts {
    standing: number;
    water: boolean;
    wet: boolean;
    walk: boolean;
    solidTop: number;
    waterTop: number;
    river: boolean;
}

type InLayer = (z: number) => boolean;

/** The layer images are painted MAP_SCALE pixels per square, so they stay crisp when zoomed. */
export const MAP_SCALE = 4;

const mapLayerImages = new WeakMap<MapLayer, string>();

// square kinds of the base image
const VOID = 0;
const FLOOR = 1;
const SHALLOW = 2;
const DEEP = 3;
const WALL = 4;
const LILY = 5;
const BRIDGE = 6;
const RIVER = 7;
const WALKABLE = [false, true, true, false, false, true, true, false];

// colours are smoothed only among squares of the same group: floors, shallow water, deep water, walls, rivers
const GROUP = [0, 1, 2, 3, 4, 1, 1, 5];

// what stands on a square in the level data
const FLOOR_STANDS = 1;
const LILY_STANDS = 2;

// marks of a square: a river there, a pushable rock there
const RIVER_MARK = 1;
const ROCK_MARK = 2;

// the sides of a square, in the order of its edge lines and fences
const WEST = 0;
const EAST = 1;
const NORTH = 2;
const SOUTH = 3;

const LILY_RGB: Rgb = [104, 168, 92];
const FENCE_RGB: Rgb = [30, 34, 38];
const ROCK_RGB: Rgb = [112, 100, 90];
const WATER_RGB: Rgb = [51, 104, 139];

/** A data URL of a map-sized image (MAP_SCALE pixels per square) whose RGBA bytes fill(pixels) writes. */
export function imageUrl(fill: (pixels: Uint8ClampedArray) => void): string {
    const [width, height] = PROG.map.size;
    const canvas = document.createElement('canvas');
    canvas.width = width * MAP_SCALE;
    canvas.height = height * MAP_SCALE;

    const context = canvas.getContext('2d')!;
    const image = context.createImageData(canvas.width, canvas.height);
    fill(image.data);
    context.putImageData(image, 0, 0);
    return canvas.toDataURL();
}

/** Writes a colour (and alpha) to the pixel at a byte offset of image data. */
export const putPixel = (pixels: Uint8ClampedArray, offset: number, color: Rgb, alpha = 255): void => {
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = alpha;
};

/** The byte offset of pixel (x, y) of square (i, j) in an image of a map width squares wide. */
export const pixelOffset = (width: number, i: number, j: number, x: number, y: number): number =>
    ((j * MAP_SCALE + y) * width * MAP_SCALE + i * MAP_SCALE + x) * 4;

// the bytes of a map layer's or Ocean_Map's base64 field, decoded once
const layerBytes = new WeakMap<object, Uint8Array>();

function bytesOf(owner: object, field: string): Uint8Array {
    let bytes = layerBytes.get(owner);
    if (!bytes) {
        bytes = fromBase64(field);
        layerBytes.set(owner, bytes);
    }

    return bytes;
}

const bitSet = (bits: Uint8Array, index: number): number => (bits[index >> 3] >> (index & 7)) & 1;

// the highest water surface the map draws per square of a layer, NaN where it draws none
function waterSurfaces(layerIndex: number, squareCount: number): Float32Array {
    const surfaces = new Float32Array(squareCount).fill(NaN);

    for (const ocean of PROG.map.oceans || []) {
        if (ocean.layer !== layerIndex) continue;

        const bits = bytesOf(ocean, ocean.water);
        for (let index = 0; index < ocean.sx * ocean.sy; index++) {
            if (!bitSet(bits, index)) continue;

            const square = mapCol(ocean.x0 + (index % ocean.sx), ocean.y0 + Math.floor(index / ocean.sx));
            const surface = surfaces[square];
            if (Number.isNaN(surface) || surface < ocean.zw) surfaces[square] = ocean.zw;
        }
    }

    return surfaces;
}

// per square, what the level data stands there: a floor or a lily (FLOOR_STANDS, LILY_STANDS), else 0
function standingOn(inLayer: InLayer, squareCount: number): Uint8Array {
    const standing = new Uint8Array(squareCount);

    for (const [, i, j, z, exists] of PROG.world.floors) {
        if (exists !== 0 && inLayer(z)) standing[gridCol(i, j)] = FLOOR_STANDS;
    }

    for (const [, i, j, z, exists] of PROG.world.lilies) {
        if (exists !== 0 && inLayer(z)) standing[gridCol(i, j)] = LILY_STANDS;
    }

    return standing;
}

// per square, its RIVER_MARK and ROCK_MARK bits
function riverAndRockMarks(inLayer: InLayer, squareCount: number): Uint8Array {
    const marks = new Uint8Array(squareCount);

    for (const [i, j, z] of PROG.world.rivers || []) {
        if (inLayer(z)) marks[gridCol(i, j)] |= RIVER_MARK;
    }

    for (const [, i, j, z] of PROG.world.rocks) {
        if (inLayer(z)) marks[gridCol(i, j)] |= ROCK_MARK;
    }

    return marks;
}

// per square, the top of the highest Wall_Set voxel (a voxel in cell z fills z to z + 1), -Infinity without one
function solidTops(inLayer: InLayer, squareCount: number): Float32Array {
    const tops = new Float32Array(squareCount).fill(-Infinity);
    if (!WORLD) return tops;

    const raise = (square: number, z: number): void => {
        if (inLayer(z) && z + 1 > tops[square]) tops[square] = z + 1;
    };

    const world = PROG.world;
    const [gridWidth, gridHeight] = world.grid.size;
    const zOffset = world.grid.zoff;
    const solid = WORLD.solid;
    const groupVoxels = WORLD.groups;

    let solidAt = 0;
    for (let column = 0; column < gridWidth * gridHeight; column++) {
        const voxelCount = solid[solidAt];
        solidAt++;
        for (let voxel = 0; voxel < voxelCount; voxel++) {
            raise(gridCol(column % gridWidth, Math.floor(column / gridWidth)), solid[solidAt] - zOffset);
            solidAt++;
        }
    }

    let voxelAt = 0;
    for (const group of world.groups) {
        for (let voxel = 0; voxel < group.n; voxel++) {
            if (group.exists !== 0) {
                raise(gridCol(groupVoxels[voxelAt], groupVoxels[voxelAt + 1]), groupVoxels[voxelAt + 2] - zOffset);
            }
            voxelAt += 3;
        }
    }

    return tops;
}

// a square's kind from what stands on it, the water the map draws there (its surface waterTop), whether the square is
// in that water (wet), whether the walk stands there, the top of its voxels and whether a river flows there
function squareKind({ standing, water, wet, walk, solidTop, waterTop, river }: SquareFacts): number {
    if (standing === LILY_STANDS) return LILY;
    if (standing && water) return BRIDGE;
    if (walk && !wet) return FLOOR;
    if (water && solidTop <= waterTop + 0.05 && river) return RIVER;
    if (walk) return SHALLOW;
    if (!water) return WALL;
    if (solidTop > waterTop + 0.5) return WALL;
    if (solidTop > waterTop + 0.05) return FLOOR;
    return DEEP;
}

// a square in the water that the walk can't stand on and no voxel fills stays a wall when it stands half a metre or
// more above the surface next to a floor (a shore cliff or wall)
function raiseShoreWalls(
    kinds: Uint8Array,
    width: number,
    heightOf: (square: number) => number,
    waterTops: Float32Array,
): void {
    const squareCount = kinds.length;

    for (let square = 0; square < squareCount; square++) {
        if (kinds[square] !== DEEP || heightOf(square) < waterTops[square] + 0.5) continue;

        const i = square % width;
        const floorWest = i > 0 && kinds[square - 1] === FLOOR;
        const floorEast = i < width - 1 && kinds[square + 1] === FLOOR;
        const floorNorth = square >= width && kinds[square - width] === FLOOR;
        const floorSouth = square < squareCount - width && kinds[square + width] === FLOOR;
        if (floorWest || floorEast || floorNorth || floorSouth) kinds[square] = WALL;
    }
}

// fences next to where the hero stands (bit per side: 1 east, 2 north, 4 west, 8 south)
function fenceSides(inLayer: InLayer, floorHeights: Float32Array | undefined, squareCount: number): Uint8Array {
    const fences = new Uint8Array(squareCount);

    for (const [, i, j, z, side, exists] of PROG.world.fences) {
        const square = gridCol(i, j);
        if (exists === 0 || !inLayer(z)) continue;

        if (!floorHeights || Math.abs(floorHeights[square] - z) <= 1) fences[square] |= 1 << side;
    }

    return fences;
}

function labDistanceSquared(lab: Float64Array, first: number, second: number): number {
    const lightness = lab[first * 3] - lab[second * 3];
    const axisA = lab[first * 3 + 1] - lab[second * 3 + 1];
    const axisB = lab[first * 3 + 2] - lab[second * 3 + 2];
    return lightness ** 2 + axisA ** 2 + axisB ** 2;
}

// per square, the median OKLab colour over the 3 x 3 squares of the same group whose colour is close; per channel the
// values that count are kept sorted (insertion sort) and the median is the middle one
function smoothColours(
    cells: Uint8Array,
    lab: Float64Array,
    kinds: Uint8Array,
    width: number,
    height: number,
): Float32Array {
    const smooth = new Float32Array(width * height * 3);
    const channelValues = [new Float64Array(9), new Float64Array(9), new Float64Array(9)];

    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            const square = j * width + i;
            if (!cells[square * 4 + 3]) continue;

            let count = 0;
            for (let offsetJ = -1; offsetJ <= 1; offsetJ++) {
                for (let offsetI = -1; offsetI <= 1; offsetI++) {
                    const neighbourI = i + offsetI;
                    const neighbourJ = j + offsetJ;
                    const neighbour = neighbourJ * width + neighbourI;
                    const offMap = neighbourI < 0 || neighbourJ < 0 || neighbourI >= width || neighbourJ >= height;
                    if (offMap || !cells[neighbour * 4 + 3]) continue;
                    if (GROUP[kinds[neighbour]] !== GROUP[kinds[square]]) continue;
                    if (labDistanceSquared(lab, neighbour, square) > 0.0049) continue;

                    for (let channel = 0; channel < 3; channel++) {
                        const values = channelValues[channel];
                        const value = lab[neighbour * 3 + channel];
                        let at = count;
                        while (at > 0 && values[at - 1] > value) {
                            values[at] = values[at - 1];
                            at--;
                        }
                        values[at] = value;
                    }
                    count++;
                }
            }

            for (let channel = 0; channel < 3; channel++) {
                smooth[square * 3 + channel] = channelValues[channel][count >> 1];
            }
        }
    }

    return smooth;
}

// the smoothed colour of a square with its lightness mapped into [low, high] and its chroma times chroma; strongly
// coloured and near-white squares keep some of their brightness
function bandColour(smooth: Float32Array, square: number, low: number, high: number, chroma: number): Rgb {
    const lightness = smooth[square * 3];
    const axisA = smooth[square * 3 + 1];
    const axisB = smooth[square * 3 + 2];
    const colourLift = 0.1 * Math.min(1, Math.max(0, (Math.hypot(axisA, axisB) - 0.08) / 0.1));
    const whiteLift = 0.6 * Math.max(0, lightness - 0.8);
    const lift = colourLift + whiteLift;

    const band = high - low;
    const position = Math.min(1, Math.max(0, (lightness - 0.3) / 0.6));
    return oklabRgb(low + lift + band * position, axisA * chroma, axisB * chroma);
}

// the water colours, from the map's water colour
function waterPalette(): WaterPalette {
    const deep = PROG.map.water_rgb || WATER_RGB;
    const deepLab = oklab(...deep);
    return {
        deep,
        deepLab,
        shallow: oklabRgb(deepLab[0] + 0.12, deepLab[1] * 0.8, deepLab[2] * 0.8),
        river: oklabRgb(deepLab[0] + 0.07, deepLab[1], deepLab[2]),
        riverEdge: oklabRgb(deepLab[0] + 0.33, deepLab[1] * 0.4, deepLab[2] * 0.4),
    };
}

// the colour a square of a kind is filled with
function squareFill(kind: number, square: number, smooth: Float32Array, palette: WaterPalette): Rgb {
    if (kind === DEEP) return palette.deep;
    if (kind === RIVER) return palette.river;
    if (kind === SHALLOW || kind === LILY) return palette.shallow;
    if (kind === WALL) return bandColour(smooth, square, 0.22, 0.32, 0.8);
    return bandColour(smooth, square, 0.4, 0.56, 0.95);
}

// the colour of a square's edge line on the side of a neighbour, or false for none
function edgeLine(
    layerImage: LayerImage,
    square: number,
    kind: number,
    neighbour: number,
    neighbourKind: number,
): Rgb | false {
    const { smooth, palette, marks, floorHeights } = layerImage;
    if (kind === WALL) {
        if (neighbourKind === VOID) return bandColour(smooth, square, 0.4, 0.5, 0.6);
        if (!WALKABLE[neighbourKind]) return false;
        return bandColour(smooth, square, 0.14, 0.2, 0.6);
    }

    if (kind === BRIDGE) {
        if (neighbourKind === DEEP || neighbourKind === SHALLOW || neighbourKind === RIVER) return palette.shallow;
        return false;
    }

    if (kind === RIVER) {
        if (neighbourKind === RIVER) return false;

        const continuesOnto = neighbourKind === LILY || neighbourKind === BRIDGE;
        const riverGoesOn = (marks[neighbour] & RIVER_MARK) !== 0 && continuesOnto;
        if (riverGoesOn) return false;
        return palette.riverEdge;
    }

    if (kind !== FLOOR) return false;

    let dropsAway = neighbourKind === VOID;
    if (!dropsAway && WALKABLE[neighbourKind] && floorHeights) {
        dropsAway = floorHeights[neighbour] <= floorHeights[square] - 1;
    }

    if (!dropsAway) return false;
    return bandColour(smooth, square, 0.32, 0.46, 0.95);
}

// the side of its square a pixel column touches (WEST or EAST), else -1
function columnSide(x: number): number {
    if (x === 0) return WEST;
    if (x === MAP_SCALE - 1) return EAST;
    return -1;
}

// the side of its square a pixel row touches (NORTH or SOUTH), else -1
function rowSide(y: number): number {
    if (y === 0) return NORTH;
    if (y === MAP_SCALE - 1) return SOUTH;
    return -1;
}

// the colour of one pixel of a painted square: fences, then a lily's pad, a rock's dot, the edge lines and the fill
function pixelColour(paint: SquarePaint, side: number, row: number): Rgb {
    if ((side >= 0 && paint.fences[side]) || (row >= 0 && paint.fences[row])) return FENCE_RGB;

    if (paint.kind === LILY) {
        if (side < 0 || row < 0) return LILY_RGB;
        return paint.under;
    }

    if (paint.rock && side < 0 && row < 0) return ROCK_RGB;

    if (side >= 0) {
        const sideLine = paint.lines[side];
        if (sideLine) return sideLine;
    }

    if (row >= 0) {
        const rowLine = paint.lines[row];
        if (rowLine) return rowLine;
    }

    return paint.fill;
}

// the kind of square (i, j), VOID off the map
function kindAt({ width, height, kinds }: LayerImage, i: number, j: number): number {
    if (i < 0 || j < 0 || i >= width || j >= height) return VOID;
    return kinds[j * width + i];
}

// paints one square's MAP_SCALE x MAP_SCALE pixels
function paintSquare(layerImage: LayerImage, pixels: Uint8ClampedArray, i: number, j: number): void {
    const { width, kinds, marks, fences, smooth, palette } = layerImage;
    const square = j * width + i;
    const kind = kinds[square];

    // per side (west, east, north, south): the neighbour's square and kind
    const neighbours: Array<[square: number, kind: number]> = [
        [square - 1, kindAt(layerImage, i - 1, j)],
        [square + 1, kindAt(layerImage, i + 1, j)],
        [square - width, kindAt(layerImage, i, j - 1)],
        [square + width, kindAt(layerImage, i, j + 1)],
    ];
    const fence = fences[square];
    const onWaterKind = kind === DEEP || kind === RIVER || kind === SHALLOW;
    const paint: SquarePaint = {
        kind,
        fill: squareFill(kind, square, smooth, palette),
        rock: (marks[square] & ROCK_MARK) !== 0 && onWaterKind,
        lines: neighbours.map(([neighbour, neighbourKind]) =>
            edgeLine(layerImage, square, kind, neighbour, neighbourKind),
        ),
        fences: [(fence & 4) !== 0, (fence & 1) !== 0, (fence & 2) !== 0, (fence & 8) !== 0],
        under: marks[square] & RIVER_MARK ? palette.river : palette.deep,
    };

    for (let y = 0; y < MAP_SCALE; y++) {
        for (let x = 0; x < MAP_SCALE; x++) {
            putPixel(pixels, pixelOffset(width, i, j, x, y), pixelColour(paint, columnSide(x), rowSide(y)));
        }
    }
}

// per square with a colour (height byte set), its OKLab colour at square * 3
function labColours(cells: Uint8Array, squareCount: number): Float64Array {
    const lab = new Float64Array(squareCount * 3);

    for (let square = 0; square < squareCount; square++) {
        if (cells[square * 4 + 3]) {
            lab.set(oklab(cells[square * 4], cells[square * 4 + 1], cells[square * 4 + 2]), square * 3);
        }
    }

    return lab;
}

/** What classifying a layer's squares reads. */
interface KindInputs {
    layer: MapLayer;
    inLayer: InLayer;
    cells: Uint8Array;
    lab: Float64Array;
    marks: Uint8Array;
    deepLab: WaterPalette['deepLab'];
    floorHeights: Float32Array | undefined;
}

// per square, its kind: a floor where the walk can stand (floorHeights(), stored in data/walk.json), else a wall;
// water where the map draws water: shallow where the walk can stand in it, a river where the level data gives the
// water a flow, else open water unless Wall_Set voxels stand above the surface (a floor when they end within half a
// metre above it, a wall when higher) or the square is a tall shore square next to a floor (decorations poking out of
// the sea are water); lilies and floors over water on top
function squareKinds({ layer, inLayer, cells, lab, marks, deepLab, floorHeights }: KindInputs): Uint8Array {
    const [width, height] = PROG.map.size;
    const squareCount = width * height;
    const waterTops = waterSurfaces(PROG.map.layers.indexOf(layer), squareCount);
    const standing = standingOn(inLayer, squareCount);
    const voxelTops = solidTops(inLayer, squareCount);

    // a square the walk stands in is in the water when the map draws the water surface there, or when it has the
    // water's colour (a shore square whose highest point stands just above the surface)
    const waterColoured = (square: number): boolean => {
        const lightness = lab[square * 3] - deepLab[0];
        const axisA = lab[square * 3 + 1] - deepLab[1];
        const axisB = lab[square * 3 + 2] - deepLab[2];
        return lightness ** 2 + axisA ** 2 + axisB ** 2 < 0.0036;
    };

    const kinds = new Uint8Array(squareCount);
    const heightOf = (square: number): number => layer.zbase + (cells[square * 4 + 3] - 1) * layer.zscale;

    for (let square = 0; square < squareCount; square++) {
        if (!cells[square * 4 + 3]) continue;

        const waterTop = waterTops[square];
        const water = !Number.isNaN(waterTop);
        const wet = water && (heightOf(square) <= waterTop + layer.zscale + 0.01 || waterColoured(square));
        let walk = !wet;
        if (floorHeights) walk = !Number.isNaN(floorHeights[square]);

        kinds[square] = squareKind({
            standing: standing[square],
            water,
            wet,
            walk,
            solidTop: voxelTops[square],
            waterTop,
            river: (marks[square] & RIVER_MARK) !== 0,
        });
    }

    raiseShoreWalls(kinds, width, heightOf, waterTops);
    return kinds;
}

// the pixels of every square that is not VOID: floors take the square's map colour with its noise smoothed away (a
// median over the 3 x 3 squares of the same group whose colour is close, so hue boundaries and small patches stay) and
// its lightness held in a mid band, walls the same hue darker, with a crisp darker line where they meet a floor and a
// lighter rim against empty squares; a floor a metre or more above a neighbouring floor, or at the edge of empty
// squares, gets a darker line on that side; a river is a lighter channel with a light line along the sides it does not
// continue to; the level data's pushable rocks are a dot in the water; fences are a dark line
function paintLayer(layerImage: LayerImage): Uint8ClampedArray {
    const { width, height, kinds } = layerImage;
    const pixels = new Uint8ClampedArray(width * height * MAP_SCALE * MAP_SCALE * 4);

    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            if (kinds[j * width + i] !== VOID) paintSquare(layerImage, pixels, i, j);
        }
    }

    return pixels;
}

const basePixels = new WeakMap<MapLayer, Uint8ClampedArray>();

// The pixels of one layer's base image, MAP_SCALE per square, kept per layer once the walk floors are known
function layerPixels(layer: MapLayer): Uint8ClampedArray {
    const kept = basePixels.get(layer);
    if (kept) return kept;

    const [width, height] = PROG.map.size;
    const squareCount = width * height;
    const cells = bytesOf(layer, layer.cells);
    const inLayer: InLayer = (z) => z >= layer.z[0] && z < layer.z[1];
    const floorHeights = FLOOR_HEIGHTS?.[layer.key];
    const marks = riverAndRockMarks(inLayer, squareCount);
    const lab = labColours(cells, squareCount);
    const palette = waterPalette();

    const kinds = squareKinds({ layer, inLayer, cells, lab, marks, deepLab: palette.deepLab, floorHeights });
    const layerImage: LayerImage = {
        width,
        height,
        kinds,
        marks,
        floorHeights,
        palette,
        fences: fenceSides(inLayer, floorHeights, squareCount),
        smooth: smoothColours(cells, lab, kinds, width, height),
    };

    const pixels = paintLayer(layerImage);
    if (floorHeights) basePixels.set(layer, pixels);
    return pixels;
}

/**
 * One layer's base image (layerPixels()) as a data URL. With fog given, fogged squares are painted in the fog colour,
 * so the image holds nothing the fog hides; the image without fog depends on the level data only and is kept per layer.
 */
export function mapLayerImage(layer: MapLayer, fog?: Fog | null): string {
    if (!fog) {
        const kept = mapLayerImages.get(layer);
        if (kept !== undefined) return kept;
    }

    const [width, height] = PROG.map.size;
    const [cornerX, cornerY] = PROG.map.corner;
    const url = imageUrl((pixels) => {
        pixels.set(layerPixels(layer));
        if (!fog) return;

        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                if (!fog.cover(layer.key, cornerX + i, cornerY + height - 1 - j)) continue;

                for (let y = 0; y < MAP_SCALE; y++) {
                    for (let x = 0; x < MAP_SCALE; x++) {
                        putPixel(pixels, pixelOffset(width, i, j, x, y), FOG_RGB);
                    }
                }
            }
        }
    });

    if (!fog && basePixels.has(layer)) mapLayerImages.set(layer, url);
    return url;
}

/**
 * Squares that an OCEAN_CHANGE of the save's latest state turned into water, per map layer, where the drawn ground lies
 * below the water surface.
 */
export function oceanWater(latest: LatestValues | null | undefined): OceanSquares {
    const squares: OceanSquares = {};
    const map = PROG.map;
    if (!latest?.ocean.length || !map?.oceans) return squares;

    const oceanByPid = new Map(map.oceans.map((ocean) => [ocean.pid, ocean]));
    const [cornerX, cornerY] = map.corner;
    const [width, height] = map.size;

    for (const change of latest.ocean) {
        const ocean = oceanByPid.get(change.pid);
        if (!ocean) continue;

        const layer = map.layers[ocean.layer];
        if (!layer || !(change.new & 1) || change.index >= ocean.sx * ocean.sy) continue;

        // water from the start
        if (bitSet(bytesOf(ocean, ocean.water), change.index)) continue;

        const square = mapCol(ocean.x0 + (change.index % ocean.sx), ocean.y0 + Math.floor(change.index / ocean.sx));
        const i = square % width;
        const j = height - 1 - Math.floor(square / width);
        const heightByte = bytesOf(layer, layer.cells)[square * 4 + 3];
        if (heightByte && layer.zbase + (heightByte - 1) * layer.zscale >= ocean.zw) continue;

        let layerSquares = squares[layer.key];
        if (!layerSquares) {
            layerSquares = [];
            squares[layer.key] = layerSquares;
        }
        layerSquares.push([cornerX + i, cornerY + j]);
    }

    return squares;
}
