// The base image of one map layer (DATAFILES.md "The viewer's base image"): every square's kind and colour from the
// map's colour and height grid (DATAFILES.md "The colour and height grid (map.json)"), the level data and the walk's
// floor heights, painted MAP_SCALE pixels per square; and the squares an OCEAN_CHANGE turned into water
import { fromBase64, PROG, WORLD } from '../data.js';
import { gridCol, mapCol } from '../walk/cells.js';
import { FLOOR_HEIGHTS } from '../walk-data.js';
import { FOG_RGB, oklab, oklabRgb } from './colors.js';

// the layer images are painted MAP_SCALE pixels per square, so they stay crisp when zoomed
export const MAP_SCALE = 4;
const mapLayerImages = new WeakMap();
// square kinds of the base image
const VOID = 0,
    FLOOR = 1,
    SHALLOW = 2,
    DEEP = 3,
    WALL = 4,
    LILY = 5,
    BRIDGE = 6,
    RIVER = 7,
    WALKABLE = [false, true, true, false, false, true, true, false],
    // colours are smoothed only among squares of the same group: floors, shallow water, deep water, walls, rivers
    GROUP = [0, 1, 2, 3, 4, 1, 1, 5];
// what stands on a square in the level data
const FLOOR_STANDS = 1,
    LILY_STANDS = 2;
// marks of a square: a river there, a pushable rock there
const RIVER_MARK = 1,
    ROCK_MARK = 2;
// the sides of a square, in the order of its edge lines and fences
const WEST = 0,
    EAST = 1,
    NORTH = 2,
    SOUTH = 3;
const LILY_RGB = [104, 168, 92],
    FENCE_RGB = [30, 34, 38],
    ROCK_RGB = [112, 100, 90],
    WATER_RGB = [51, 104, 139];

// a data URL of a map-sized image (MAP_SCALE pixels per square) whose RGBA bytes fill(pixels) writes
export function imageUrl(fill) {
    const [width, height] = PROG.map.size,
        canvas = document.createElement('canvas');
    canvas.width = width * MAP_SCALE;
    canvas.height = height * MAP_SCALE;
    const context = canvas.getContext('2d'),
        image = context.createImageData(canvas.width, canvas.height);
    fill(image.data);
    context.putImageData(image, 0, 0);
    return canvas.toDataURL();
}
// writes a colour (and alpha) to the pixel at a byte offset of image data
export const putPx = (pixels, offset, color, alpha = 255) => {
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = alpha;
};
// the byte offset of pixel (x, y) of square (i, j) in an image of a map width squares wide
export const pixelOffset = (width, i, j, x, y) => ((j * MAP_SCALE + y) * width * MAP_SCALE + i * MAP_SCALE + x) * 4;

// the bytes of a map layer's or Ocean_Map's base64 field, decoded once
const layerBytes = new WeakMap();
function bytesOf(owner, field) {
    if (!layerBytes.has(owner)) layerBytes.set(owner, fromBase64(field));
    return layerBytes.get(owner);
}
const bitSet = (bits, index) => (bits[index >> 3] >> (index & 7)) & 1;

// the highest water surface the map draws per square of a layer, NaN where it draws none
function waterSurfaces(layerIndex, squareCount) {
    const surfaces = new Float32Array(squareCount).fill(NaN);
    for (const ocean of PROG.map.oceans || []) {
        if (ocean.layer !== layerIndex) continue;
        const bits = bytesOf(ocean, ocean.water);
        for (let k = 0; k < ocean.sx * ocean.sy; k++) {
            if (!bitSet(bits, k)) continue;
            const square = mapCol(ocean.x0 + (k % ocean.sx), ocean.y0 + Math.floor(k / ocean.sx));
            if (!(surfaces[square] >= ocean.zw)) surfaces[square] = ocean.zw;
        }
    }
    return surfaces;
}
// per square, what the level data stands there: a floor or a lily (FLOOR_STANDS, LILY_STANDS), else 0
function standingOn(inLayer, squareCount) {
    const standing = new Uint8Array(squareCount);
    for (const [, i, j, z, exists] of PROG.world.floors)
        if (exists !== 0 && inLayer(z)) standing[gridCol(i, j)] = FLOOR_STANDS;
    for (const [, i, j, z, exists] of PROG.world.lilies)
        if (exists !== 0 && inLayer(z)) standing[gridCol(i, j)] = LILY_STANDS;
    return standing;
}
// per square, its RIVER_MARK and ROCK_MARK bits
function riverAndRockMarks(inLayer, squareCount) {
    const marks = new Uint8Array(squareCount);
    for (const [i, j, z] of PROG.world.rivers || []) if (inLayer(z)) marks[gridCol(i, j)] |= RIVER_MARK;
    for (const [, i, j, z] of PROG.world.rocks) if (inLayer(z)) marks[gridCol(i, j)] |= ROCK_MARK;
    return marks;
}
// per square, the top of the highest Wall_Set voxel (a voxel in cell z fills z to z + 1), -Infinity without one
function solidTops(inLayer, squareCount) {
    const tops = new Float32Array(squareCount).fill(-Infinity);
    if (!WORLD) return tops;
    const raise = (square, z) => {
        if (inLayer(z) && z + 1 > tops[square]) tops[square] = z + 1;
    };
    const world = PROG.world,
        [gridWidth, gridHeight] = world.grid.size,
        zOffset = world.grid.zoff,
        solid = WORLD.solid,
        groupVoxels = WORLD.groups;
    for (let column = 0, at = 0; column < gridWidth * gridHeight; column++)
        for (let count = solid[at++]; count > 0; count--)
            raise(gridCol(column % gridWidth, Math.floor(column / gridWidth)), solid[at++] - zOffset);
    for (let group = 0, at = 0; group < world.groups.length; group++)
        for (let count = world.groups[group].n; count > 0; count--, at += 3)
            if (world.groups[group].exists !== 0)
                raise(gridCol(groupVoxels[at], groupVoxels[at + 1]), groupVoxels[at + 2] - zOffset);
    return tops;
}
// a square's kind from what stands on it, the water the map draws there (its surface waterTop), whether the square is
// in that water (wet), whether the walk stands there, the top of its voxels and whether a river flows there
function squareKind({ standing, water, wet, walk, solidTop, waterTop, river }) {
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
function raiseShoreWalls(kinds, width, heightOf, waterTops) {
    const squareCount = kinds.length;
    for (let square = 0; square < squareCount; square++) {
        if (kinds[square] !== DEEP || heightOf(square) < waterTops[square] + 0.5) continue;
        const i = square % width;
        if (
            (i > 0 && kinds[square - 1] === FLOOR) ||
            (i < width - 1 && kinds[square + 1] === FLOOR) ||
            (square >= width && kinds[square - width] === FLOOR) ||
            (square < squareCount - width && kinds[square + width] === FLOOR)
        )
            kinds[square] = WALL;
    }
}
// fences next to where the hero stands (bit per side: 1 east, 2 north, 4 west, 8 south)
function fenceSides(inLayer, floorHeights, squareCount) {
    const fences = new Uint8Array(squareCount);
    for (const [, i, j, z, side, exists] of PROG.world.fences) {
        const square = gridCol(i, j);
        if (exists !== 0 && inLayer(z) && (!floorHeights || Math.abs(floorHeights[square] - z) <= 1))
            fences[square] |= 1 << side;
    }
    return fences;
}
const labDistanceSquared = (lab, a, b) =>
    (lab[a * 3] - lab[b * 3]) ** 2 + (lab[a * 3 + 1] - lab[b * 3 + 1]) ** 2 + (lab[a * 3 + 2] - lab[b * 3 + 2]) ** 2;
// per square, the median OKLab colour over the 3 x 3 squares of the same group whose colour is close; per channel the
// values that count are kept sorted (insertion sort) and the median is the middle one
function smoothColours(cells, lab, kinds, width, height) {
    const smooth = new Float32Array(width * height * 3),
        channelValues = [new Float64Array(9), new Float64Array(9), new Float64Array(9)];
    for (let j = 0; j < height; j++)
        for (let i = 0; i < width; i++) {
            const square = j * width + i;
            if (!cells[square * 4 + 3]) continue;
            let count = 0;
            for (let dj = -1; dj <= 1; dj++)
                for (let di = -1; di <= 1; di++) {
                    const ni = i + di,
                        nj = j + dj,
                        neighbour = nj * width + ni;
                    if (ni < 0 || nj < 0 || ni >= width || nj >= height || !cells[neighbour * 4 + 3]) continue;
                    if (GROUP[kinds[neighbour]] !== GROUP[kinds[square]]) continue;
                    if (labDistanceSquared(lab, neighbour, square) > 0.0049) continue;
                    for (let channel = 0; channel < 3; channel++) {
                        const values = channelValues[channel],
                            value = lab[neighbour * 3 + channel];
                        let at = count;
                        for (; at > 0 && values[at - 1] > value; at--) values[at] = values[at - 1];
                        values[at] = value;
                    }
                    count++;
                }
            for (let channel = 0; channel < 3; channel++)
                smooth[square * 3 + channel] = channelValues[channel][count >> 1];
        }
    return smooth;
}
// the smoothed colour of a square with its lightness mapped into [low, high] and its chroma times chroma; strongly
// coloured and near-white squares keep some of their brightness
function bandColour(smooth, square, low, high, chroma) {
    const lightness = smooth[square * 3],
        a = smooth[square * 3 + 1],
        b = smooth[square * 3 + 2],
        lift = 0.1 * Math.min(1, Math.max(0, (Math.hypot(a, b) - 0.08) / 0.1)) + 0.6 * Math.max(0, lightness - 0.8);
    return oklabRgb(
        low + lift + (high - low) * Math.min(1, Math.max(0, (lightness - 0.3) / 0.6)),
        a * chroma,
        b * chroma,
    );
}
// the water colours, from the map's water colour
function waterPalette() {
    const deep = PROG.map.water_rgb || WATER_RGB,
        deepLab = oklab(...deep);
    return {
        deep,
        deepLab,
        shallow: oklabRgb(deepLab[0] + 0.12, deepLab[1] * 0.8, deepLab[2] * 0.8),
        river: oklabRgb(deepLab[0] + 0.07, deepLab[1], deepLab[2]),
        riverEdge: oklabRgb(deepLab[0] + 0.33, deepLab[1] * 0.4, deepLab[2] * 0.4),
    };
}
// the colour a square of a kind is filled with
function squareFill(kind, square, smooth, palette) {
    if (kind === DEEP) return palette.deep;
    if (kind === RIVER) return palette.river;
    if (kind === SHALLOW || kind === LILY) return palette.shallow;
    if (kind === WALL) return bandColour(smooth, square, 0.22, 0.32, 0.8);
    return bandColour(smooth, square, 0.4, 0.56, 0.95);
}
// the colour of a square's edge line on the side of a neighbour, or a falsy value for none
function edgeLine(layerImage, square, kind, neighbour, neighbourKind) {
    const { smooth, palette, marks, floorHeights } = layerImage;
    if (kind === WALL) {
        if (neighbourKind === VOID) return bandColour(smooth, square, 0.4, 0.5, 0.6);
        return WALKABLE[neighbourKind] && bandColour(smooth, square, 0.14, 0.2, 0.6);
    }
    if (kind === BRIDGE)
        return (neighbourKind === DEEP || neighbourKind === SHALLOW || neighbourKind === RIVER) && palette.shallow;
    if (kind === RIVER) {
        const riverGoesOn = marks[neighbour] & RIVER_MARK && (neighbourKind === LILY || neighbourKind === BRIDGE);
        return neighbourKind !== RIVER && !riverGoesOn && palette.riverEdge;
    }
    if (kind !== FLOOR) return false;
    const dropsAway =
        neighbourKind === VOID ||
        (WALKABLE[neighbourKind] && floorHeights && floorHeights[neighbour] <= floorHeights[square] - 1);
    return dropsAway && bandColour(smooth, square, 0.32, 0.46, 0.95);
}
// the side of its square a pixel column touches (WEST or EAST), else -1
function columnSide(x) {
    if (x === 0) return WEST;
    if (x === MAP_SCALE - 1) return EAST;
    return -1;
}
// the side of its square a pixel row touches (NORTH or SOUTH), else -1
function rowSide(y) {
    if (y === 0) return NORTH;
    if (y === MAP_SCALE - 1) return SOUTH;
    return -1;
}
// the colour of one pixel of a painted square: fences, then a lily's pad, a rock's dot, the edge lines and the fill
function pixelColour(paint, side, row) {
    if ((side >= 0 && paint.fences[side]) || (row >= 0 && paint.fences[row])) return FENCE_RGB;
    if (paint.kind === LILY) {
        if (side < 0 || row < 0) return LILY_RGB;
        return paint.under;
    }
    if (paint.rock && side < 0 && row < 0) return ROCK_RGB;
    return (side >= 0 && paint.lines[side]) || (row >= 0 && paint.lines[row]) || paint.fill;
}
// the kind of square (i, j), VOID off the map
function kindAt({ width, height, kinds }, i, j) {
    if (i < 0 || j < 0 || i >= width || j >= height) return VOID;
    return kinds[j * width + i];
}
// paints one square's MAP_SCALE x MAP_SCALE pixels
function paintSquare(layerImage, pixels, i, j) {
    const { width, kinds, marks, fences, smooth, palette } = layerImage,
        square = j * width + i,
        kind = kinds[square];
    // per side (west, east, north, south): the neighbour's square and kind
    const neighbours = [
        [square - 1, kindAt(layerImage, i - 1, j)],
        [square + 1, kindAt(layerImage, i + 1, j)],
        [square - width, kindAt(layerImage, i, j - 1)],
        [square + width, kindAt(layerImage, i, j + 1)],
    ];
    const fence = fences[square];
    const paint = {
        kind,
        fill: squareFill(kind, square, smooth, palette),
        rock: marks[square] & ROCK_MARK && (kind === DEEP || kind === RIVER || kind === SHALLOW),
        lines: neighbours.map(([neighbour, neighbourKind]) =>
            edgeLine(layerImage, square, kind, neighbour, neighbourKind),
        ),
        fences: [fence & 4, fence & 1, fence & 2, fence & 8],
        under: marks[square] & RIVER_MARK ? palette.river : palette.deep,
    };
    for (let y = 0; y < MAP_SCALE; y++)
        for (let x = 0; x < MAP_SCALE; x++)
            putPx(pixels, pixelOffset(width, i, j, x, y), pixelColour(paint, columnSide(x), rowSide(y)));
}
// The pixels of one layer's base image, MAP_SCALE per square, kept per layer. Each square is a floor where the walk
// can stand (floorHeights(), stored in data/walk.json), else a wall; water where the map draws water: shallow where the walk can stand in it,
// a river where the level data gives the water a flow, else open water unless Wall_Set voxels stand above the surface
// (a floor when they end within half a metre above it, a wall when higher) or the square is a tall shore square next
// to a floor (decorations poking out of the sea are water); lilies
// and floors over water on top, and the level data's pushable rocks a dot in the water. Floors take the square's map
// colour with its noise smoothed away (a median over the 3 x 3 squares of the same group whose colour is close, so hue
// boundaries and small patches stay) and its lightness held in a mid band, walls the same hue darker, with a crisp
// darker line where they meet a floor and a lighter rim against empty squares; a floor a metre or more above a
// neighbouring floor, or at the edge of empty squares, gets a darker line on that side; a river is a lighter channel
// with a light line along the sides it does not continue to; fences are a dark line.
const basePixels = new WeakMap();
function layerPixels(layer) {
    if (basePixels.has(layer)) return basePixels.get(layer);
    const [width, height] = PROG.map.size,
        squareCount = width * height,
        cells = bytesOf(layer, layer.cells),
        inLayer = (z) => z >= layer.z[0] && z < layer.z[1];
    const waterTops = waterSurfaces(PROG.map.layers.indexOf(layer), squareCount),
        floorHeights = FLOOR_HEIGHTS?.[layer.key],
        standing = standingOn(inLayer, squareCount),
        marks = riverAndRockMarks(inLayer, squareCount),
        voxelTops = solidTops(inLayer, squareCount);
    // per square with a colour (height byte set), its OKLab colour at square * 3
    const lab = new Float64Array(squareCount * 3);
    for (let square = 0; square < squareCount; square++)
        if (cells[square * 4 + 3])
            lab.set(oklab(cells[square * 4], cells[square * 4 + 1], cells[square * 4 + 2]), square * 3);
    const palette = waterPalette(),
        { deepLab } = palette;
    // a square the walk stands in is in the water when the map draws the water surface there, or when it has the
    // water's colour (a shore square whose highest point stands just above the surface)
    const waterColoured = (square) =>
        (lab[square * 3] - deepLab[0]) ** 2 +
            (lab[square * 3 + 1] - deepLab[1]) ** 2 +
            (lab[square * 3 + 2] - deepLab[2]) ** 2 <
        0.0036;
    const kinds = new Uint8Array(squareCount),
        heightOf = (square) => layer.zbase + (cells[square * 4 + 3] - 1) * layer.zscale;
    for (let square = 0; square < squareCount; square++) {
        if (!cells[square * 4 + 3]) continue;
        const waterTop = waterTops[square],
            water = waterTop === waterTop,
            wet = water && (heightOf(square) <= waterTop + layer.zscale + 0.01 || waterColoured(square));
        let walk = !wet;
        if (floorHeights) walk = floorHeights[square] === floorHeights[square];
        kinds[square] = squareKind({
            standing: standing[square],
            water,
            wet,
            walk,
            solidTop: voxelTops[square],
            waterTop,
            river: marks[square] & RIVER_MARK,
        });
    }
    raiseShoreWalls(kinds, width, heightOf, waterTops);
    const layerImage = {
        width,
        height,
        kinds,
        marks,
        floorHeights,
        palette,
        fences: fenceSides(inLayer, floorHeights, squareCount),
        smooth: smoothColours(cells, lab, kinds, width, height),
    };
    const pixels = new Uint8ClampedArray(squareCount * MAP_SCALE * MAP_SCALE * 4);
    for (let j = 0; j < height; j++)
        for (let i = 0; i < width; i++) if (kinds[j * width + i] !== VOID) paintSquare(layerImage, pixels, i, j);
    // kept once the walk floors are known
    if (floorHeights) basePixels.set(layer, pixels);
    return pixels;
}
// One layer's base image (layerPixels()) as a data URL. With fog given, fogged squares are painted in the fog colour,
// so the image holds nothing the fog hides; the image without fog depends on the level data only and is kept per layer.
export function mapLayerImage(layer, fog) {
    if (!fog && mapLayerImages.has(layer)) return mapLayerImages.get(layer);
    const [width, height] = PROG.map.size,
        [cornerX, cornerY] = PROG.map.corner;
    const url = imageUrl((pixels) => {
        pixels.set(layerPixels(layer));
        if (!fog) return;
        for (let j = 0; j < height; j++)
            for (let i = 0; i < width; i++) {
                if (!fog.cover(layer.key, cornerX + i, cornerY + height - 1 - j)) continue;
                for (let y = 0; y < MAP_SCALE; y++)
                    for (let x = 0; x < MAP_SCALE; x++) putPx(pixels, pixelOffset(width, i, j, x, y), FOG_RGB);
            }
    });
    if (!fog && basePixels.has(layer)) mapLayerImages.set(layer, url);
    return url;
}
// squares that an OCEAN_CHANGE of the save's latest state turned into water, per map layer, where the drawn ground lies
// below the water surface
export function oceanWater(latest) {
    const out = {},
        map = PROG.map;
    if (!latest?.ocean.length || !map?.oceans) return out;
    const oceanByPid = new Map(map.oceans.map((ocean) => [ocean.pid, ocean])),
        [cornerX, cornerY] = map.corner,
        [width, height] = map.size;
    for (const change of latest.ocean) {
        const ocean = oceanByPid.get(change.pid),
            layer = ocean && map.layers[ocean.layer];
        if (!layer || !(change.new & 1) || change.index >= ocean.sx * ocean.sy) continue;
        // water from the start
        if (bitSet(bytesOf(ocean, ocean.water), change.index)) continue;
        const square = mapCol(ocean.x0 + (change.index % ocean.sx), ocean.y0 + Math.floor(change.index / ocean.sx)),
            i = square % width,
            j = height - 1 - Math.floor(square / width);
        const heightByte = bytesOf(layer, layer.cells)[square * 4 + 3];
        if (heightByte && layer.zbase + (heightByte - 1) * layer.zscale >= ocean.zw) continue;
        (out[layer.key] ||= []).push([cornerX + i, cornerY + j]);
    }
    return out;
}
