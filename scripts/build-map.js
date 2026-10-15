// Builds data/map.json: a top-down colour and height grid of the overworld, one per height layer, which
// build-progress.js embeds for the viewer's map.
//
// Reads data/levels.json (overworld settings), <game>/data/levels.package and the game's render assets.
// Writes data/map.json.
//
// Usage: node scripts/build-map.js [--game DIR]
//
// How it is drawn (docs/DATAFILES.md "Drawing the map"; the file formats are in docs/GAMEDATA.md "Render assets"):
// - Every visible mesh entity of data-common/overworld.entities is rendered from above: its LOD1 triangles (mesh-local
//   positions from data-pc/<mesh>.compressed_mesh, then scale, quaternion, position) are rasterized into a grid of
//   1/SUB m sub-squares, and each layer keeps the highest surface per sub-square (a z-buffer). A grid square takes the
//   mean colour of its covered sub-squares and the height of the highest one.
// - A sub-square's colour is the albedo the game's shaders compute at that point of the triangle: the diffuse texture
//   read through the interpolated UV x material tint x entity tint_color_a/_b, two layers blended by the interpolated
//   red vertex paint (data-common/overworld.all_paint_data, or the mesh's own vertex colours), and for ground_general
//   the per-level tint maps sampled at the point's world position. Cut-out materials leave their transparent texels
//   out. Displayed colour = sRGB(EXPOSURE x albedo), with a soft shoulder; EXPOSURE stands in for the game's lighting
//   and was fitted to an in-game full-map screenshot.
// - Only scenery types (MESH_TYPES) are drawn, without INVISIBLE entities, HIDDEN_IN_MAP_VIEW Inanimates and pure
//   black materials; visible Wall_Sets are drawn as unit voxels in their tint colour. Metallic gold (gold rooms) comes
//   out as its tint colour, e.g. entity tint (1, 0.6, 0.04) -> about #fcd040.
// - Water comes from Ocean_Map.ocean_values (bit 0 = water), `sink` below the map's z, in the level's initial state; it
//   covers anything lower, lightened where the floor is just below the surface. Maps with detect_holes are all water
//   except under the voxels of the OCEAN_HOLE Wall_Sets that name them (ocean_hole_id); maps in an existence group that
//   do not exist at the start are skipped. A save's OCEAN_CHANGE actions only set flow bits and add water.
// - Layers follow the game's ground layer table (layers.js: Settings underground/skyground barriers and the
//   FAST_TRAVEL Camera_Markers); the fast-travel rooms are left out. A Group's bind_to_layer overrides z.
//
// map.json:
//   {corner: [x, y], size: [W, H], layers: [{key, name, z: [z0, z1], zbase, zscale, cells}]}
//   corner is the world position of square (0, 0)'s centre; square (i, j) covers x in [corner.x + i - 0.5, +1) and
//   y in [corner.y + j - 0.5, +1). cells = base64 of W*H*4 bytes, row-major, row 0 = north (j = H - 1), each square
//   R, G, B (sRGB), height byte h: h = 0 means nothing there (RGB 0), otherwise the surface is at
//   z = zbase + (h - 1) * zscale.
//   water_rgb: the displayed open-water colour. oceans: [{pid, layer (index into layers), x0, y0, sx, sy, zw, water}]
//   for every drawn Ocean_Map: ocean_values index k is world square (x0 + k % sx, y0 + floor(k / sx)), the water surface
//   is at zw, and water = base64 of the initial bit-0 mask, packed little-endian (bit k % 8 of byte k >> 3), holes applied.
import { readFileSync } from 'node:fs';
import { materialRecipe, shadePoint, Textures } from './lib/albedo.js';
import { get, refOf } from './lib/fields.js';
import { GROUP_LAYER, fastTravelBoxes, groundLayer, layerSettings, layerTable } from './lib/layers.js';
import { modulo, roundTo } from './lib/math.js';
import { writeJsonAtomic } from './lib/output.js';
import { Package } from './lib/package.js';
import * as paths from './lib/paths.js';
import { Materials, readMesh, readPaint } from './lib/render-assets.js';
import { isAxisAligned, wallVoxels } from './lib/voxels.js';

// sub-squares per metre
const SUB = 4;
const LOD = 1;
// output layers, with their index in the ground layer table (0 ONGROUND, 1 UNDERGROUND, 2 SKYGROUND)
const LAYERS = [
    { key: 'underworld', name: 'Underworld', fog: 1 },
    { key: 'ground', name: 'Ground', fog: 0 },
    { key: 'sky', name: 'Sky', fog: 2 },
];
// scenery; puzzle and progress entities (level entries, Freezers, gems, ...) change look at runtime and are left out
const MESH_TYPES = new Set(['Inanimate', 'Rock', 'Procedurally_Animating', 'Tree', 'Stairs', 'Elevator_Platform']);
const MAP_TYPES = new Set([...MESH_TYPES, 'Group', 'Wall_Set', 'Ocean_Map']);
const WALL_ALBEDO = 0.75;
// albedo -> displayed colour (warm sun), matched to the full-map screenshot
const EXPOSURE = [1.85, 1.72, 1.5];
const WATER_DEPTH_WEIGHT = 0.34;
const WATER_SKY = [0.018, 0.002, 0.016];
const WATER_MATERIAL = 'Ocean_Basic~overworld';
const DEFAULT_DEPTH_COLOUR = [0, 0.23, 0.46];
// shallow-water highlight
const FOAM = [0.11, 0.23, 0.39];
const SHALLOW_DEPTH = 1.2;
const FOAM_MIX = 0.5;
const FLOOR_MIX = 0.1;
const TONE_KNEE = 0.8;
const MAX_GROUP_DEPTH = 16;
const COSMETIC_ONLY = 'EXISTS_FOR_COSMETIC_TRANSITION_PURPOSES_ONLY';
const HEIGHT_STEPS = 254;
// the sub-squares of a grid square are covered enough for the square to be drawn at this many of them
const MIN_COVERED = (SUB * SUB) / 4;
// a triangle whose area seen from above is below this (in square sub-squares) is edge-on and leaves nothing
const EDGE_ON_AREA = 1e-9;

function clamp(value, low, high) {
    return Math.min(Math.max(value, low), high);
}

// Sub-square centres inside a square, as offsets from the square centre, in the order y outer and x inner
function subSquareOffsets() {
    const steps = [];
    for (let i = 0; i < SUB; i++) steps.push((i + 0.5) / SUB - 0.5);
    const offsets = [];
    for (const y of steps) {
        for (const x of steps) offsets.push([x, y]);
    }
    return offsets;
}

function hasFlag(fields, flag) {
    const flags = fields['base.entity_flags'];
    return Array.isArray(flags) && flags.includes(flag);
}

function hiddenInMap(value) {
    if (typeof value === 'number') return (value & 1) !== 0;
    if (typeof value === 'string') return value === 'HIDDEN_IN_MAP_VIEW';
    return Array.isArray(value) && value.includes('HIDDEN_IN_MAP_VIEW');
}

function vectorField(fields, prefix, fallbacks) {
    return ['x', 'y', 'z'].map((axis, i) => get(fields, prefix + axis, fallbacks[i]));
}

// The highest surface per sub-square for each of the three layers, and its colour
class Canvas {
    constructor(corner, size) {
        this.cornerX = corner[0];
        this.cornerY = corner[1];
        this.width = size[0];
        this.height = size[1];
        this.subWidth = this.width * SUB;
        this.subHeight = this.height * SUB;
        this.cellsPerLayer = this.subWidth * this.subHeight;
        const cells = LAYERS.length * this.cellsPerLayer;
        this.heights = new Float64Array(cells).fill(-Infinity);
        this.colours = new Float32Array(cells * 3);
    }

    // Sub-square coordinates of a world position: sub-square k covers [k, k + 1)
    subX(x) {
        return (x - this.cornerX + 0.5) * SUB;
    }

    subY(y) {
        return (y - this.cornerY + 0.5) * SUB;
    }

    // The key of sub-square (column, row), which wraps with the world
    keyAt(layer, column, row) {
        return layer * this.cellsPerLayer + modulo(row, this.subHeight) * this.subWidth + modulo(column, this.subWidth);
    }

    // The key of the sub-square holding a world position
    keyOf(layer, x, y) {
        return this.keyAt(layer, Math.floor(this.subX(x)), Math.floor(this.subY(y)));
    }

    isBelow(key, z) {
        return z > this.heights[key];
    }

    // Keeps the surface when it is higher than what the sub-square holds
    write(key, z, colour) {
        if (!(z > this.heights[key])) return;
        this.heights[key] = z;
        this.colours[key * 3] = colour[0];
        this.colours[key * 3 + 1] = colour[1];
        this.colours[key * 3 + 2] = colour[2];
    }
}

// The overworld's entities that are drawn, with the lookups to place them on a layer
class Scenery {
    constructor(pkg) {
        this.entities = pkg.level('overworld', MAP_TYPES);
        this.groups = new Map();
        for (const entity of this.entities) {
            if (entity.type === 'Group') this.groups.set(entity.pid, entity.fields);
        }
        const withDefaults = pkg.levelWithDefaults('overworld', new Set(['Settings', 'Camera_Marker', 'Group']));
        const settings = withDefaults.find((entity) => entity.type === 'Settings').fields;
        const cameras = withDefaults.filter((entity) => entity.type === 'Camera_Marker');
        this.existenceDefault = new Map();
        for (const { type, pid, fields } of withDefaults) {
            if (type === 'Group' && fields.is_existence_group) {
                this.existenceDefault.set(pid, Boolean(fields.exists_by_default));
            }
        }
        this.table = layerTable(layerSettings(settings), fastTravelBoxes(cameras.map((entity) => entity.fields)));
        this.layerIndex = new Map(LAYERS.map((layer, index) => [layer.fog, index]));
    }

    // The layer a Group chain binds an entity to, or null
    boundLayer(fields) {
        let group = fields['base.group_id'];
        let depth = 0;
        while (group && depth < MAX_GROUP_DEPTH) {
            const groupFields = this.groups.get(group[1]);
            if (groupFields === undefined) return null;
            const bind = groupFields.bind_to_layer;
            if (bind && bind !== 'NONE') return GROUP_LAYER[bind] ?? null;
            group = groupFields['base.group_id'];
            depth++;
        }
        return null;
    }

    // Whether an entity exists when the level loads (docs/ENTITIES.md "Existence groups"): a direct member of an
    // existence Group follows the Group's exists_by_default, another entity in an existence group its stored
    // CURRENTLY_EXISTS; an EXISTS_FOR_COSMETIC_TRANSITION_PURPOSES_ONLY one is no member and exists only by its flags
    existsAtLoad(fields) {
        const cosmetic = hasFlag(fields, COSMETIC_ONLY);
        const group = refOf(fields['base.group_id']);
        if (this.existenceDefault.has(group) && !cosmetic) return this.existenceDefault.get(group);
        if (hasFlag(fields, 'IN_EXISTENCE_GROUP')) return hasFlag(fields, 'CURRENTLY_EXISTS');
        return !cosmetic;
    }

    // Output layer index of an entity, -1 for the fast-travel rooms
    outputLayer(fields) {
        const z = get(fields, 'base.position.z', 0);
        const layer = groundLayer(this.table, z, this.boundLayer(fields));
        return this.layerIndex.get(layer) ?? -1;
    }
}

// The 3x3 rotation of a quaternion (x, y, z, w), row-major, times the entity's scale per column
function placementMatrix(quaternion, scale) {
    let [x, y, z, w] = quaternion;
    const length = Math.hypot(x, y, z, w) || 1;
    x /= length;
    y /= length;
    z /= length;
    w /= length;
    const rotation = [
        1 - 2 * (y * y + z * z),
        2 * (x * y - z * w),
        2 * (x * z + y * w),
        2 * (x * y + z * w),
        1 - 2 * (x * x + z * z),
        2 * (y * z - x * w),
        2 * (x * z - y * w),
        2 * (y * z + x * w),
        1 - 2 * (x * x + y * y),
    ];
    return rotation.map((value, i) => value * scale[i % 3]);
}

// Negative for a mirrored placement
function determinant(matrix) {
    const [a, b, c, d, e, f, g, h, i] = matrix;
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

// An entity's placement: position, matrix and tint colours
function placementOf(fields) {
    const orientation = [...vectorField(fields, 'base.orientation.', [0, 0, 0]), get(fields, 'base.orientation.w', 1)];
    const scale = vectorField(fields, 'base.scale.', [1, 1, 1]);
    return {
        position: vectorField(fields, 'base.position.', [0, 0, 0]),
        matrix: placementMatrix(orientation, scale),
        tintA: vectorField(fields, 'base.tint_color_a.', [1, 1, 1]),
        tintB: vectorField(fields, 'base.tint_color_b.', [1, 1, 1]),
    };
}

// The mesh's vertices in the world, x, y, z per vertex
function worldVertices(mesh, placement) {
    const { matrix, position } = placement;
    const local = mesh.positions;
    const world = new Float64Array(local.length);
    for (let at = 0; at < local.length; at += 3) {
        for (let row = 0; row < 3; row++) {
            const rotated =
                matrix[row * 3] * local[at] + matrix[row * 3 + 1] * local[at + 1] + matrix[row * 3 + 2] * local[at + 2];
            world[at + row] = rotated + position[row];
        }
    }
    return world;
}

// The recipe of each triangle list's material for one entity: base.materials[i], when set, overrides material i
function listRecipes(fields, mesh, lod, context) {
    const overrides = fields['base.materials'] ?? [];
    return lod.map(({ material }) => {
        let name = '';
        if (material < overrides.length && overrides[material]) name = overrides[material];
        else if (material < mesh.materials.length) name = mesh.materials[material];
        return materialRecipe(context.materials, context.textures, name, context.recipeCache);
    });
}

// One drawn surface point, filled in per sub-square and handed to shadePoint
function newPoint(placement) {
    return { u: 0, v: 0, red: 0, x: 0, y: 0, tintA: placement.tintA, tintB: placement.tintB };
}

// Everything a triangle's samples interpolate: sub-square coordinates and z, UV, red paint and world x, y per corner
function triangleCorners(indexes, world, mesh, vertexPaint, canvas) {
    return indexes.map((index) => {
        const x = world[index * 3];
        const y = world[index * 3 + 1];
        return {
            column: canvas.subX(x),
            row: canvas.subY(y),
            z: world[index * 3 + 2],
            u: mesh.uvs[index * 2],
            v: mesh.uvs[index * 2 + 1],
            red: (vertexPaint[index] & 0xff) / 255,
            x,
            y,
        };
    });
}

// Shades and keeps the triangle's surface at barycentric weights (a, b, c) in sub-square (column, row)
function drawSample(target, corners, weights, column, row) {
    const { canvas, layer, recipe, point, colour, scratch } = target;
    const [first, second, third] = corners;
    const [a, b, c] = weights;
    const z = a * first.z + b * second.z + c * third.z;
    const key = canvas.keyAt(layer, column, row);
    if (!canvas.isBelow(key, z)) return;
    point.u = a * first.u + b * second.u + c * third.u;
    point.v = a * first.v + b * second.v + c * third.v;
    point.red = a * first.red + b * second.red + c * third.red;
    point.x = a * first.x + b * second.x + c * third.x;
    point.y = a * first.y + b * second.y + c * third.y;
    if (!shadePoint(recipe, point, colour, scratch)) return;
    canvas.write(key, z, colour);
}

// The triangle seen from above, on every sub-square whose centre it covers. A triangle smaller than a sub-square that
// covers no centre still leaves its centroid, so fine detail does not vanish. A front face winds counter-clockwise
// seen from outside (a mirrored placement swaps that), so one that winds clockwise seen from above faces down and is
// not seen, unless its material is two-sided.
function rasterizeTriangle(target, corners) {
    const { canvas } = target;
    const [first, second, third] = corners;
    const area =
        (second.column - first.column) * (third.row - first.row) -
        (third.column - first.column) * (second.row - first.row);
    if (Math.abs(area) < EDGE_ON_AREA) return;
    if (!target.recipe.twoSided && area * target.winding < 0) return;
    const minColumn = Math.min(first.column, second.column, third.column);
    const maxColumn = Math.max(first.column, second.column, third.column);
    const minRow = Math.min(first.row, second.row, third.row);
    const maxRow = Math.max(first.row, second.row, third.row);
    const startColumn = Math.ceil(minColumn - 0.5);
    const endColumn = Math.min(Math.floor(maxColumn - 0.5), startColumn + canvas.subWidth - 1);
    const startRow = Math.ceil(minRow - 0.5);
    const endRow = Math.min(Math.floor(maxRow - 0.5), startRow + canvas.subHeight - 1);
    let covered = false;
    for (let row = startRow; row <= endRow; row++) {
        const centreRow = row + 0.5;
        for (let column = startColumn; column <= endColumn; column++) {
            const centreColumn = column + 0.5;
            const weightA = edge(second, third, centreColumn, centreRow) / area;
            const weightB = edge(third, first, centreColumn, centreRow) / area;
            const weightC = 1 - weightA - weightB;
            if (weightA < 0 || weightB < 0 || weightC < 0) continue;
            covered = true;
            drawSample(target, corners, [weightA, weightB, weightC], column, row);
        }
    }
    if (covered) return;
    const centroidColumn = Math.floor((first.column + second.column + third.column) / 3);
    const centroidRow = Math.floor((first.row + second.row + third.row) / 3);
    drawSample(target, corners, [1 / 3, 1 / 3, 1 / 3], centroidColumn, centroidRow);
}

// Twice the signed area of (from, to, point), in sub-square units
function edge(from, to, column, row) {
    return (to.column - from.column) * (row - from.row) - (to.row - from.row) * (column - from.column);
}

// Draws one entity's mesh; returns its triangle count
function drawEntity(entity, mesh, context) {
    const { canvas, paint } = context;
    const { fields, layer } = entity;
    const placement = placementOf(fields);
    const lod = mesh.lods[Math.min(LOD, mesh.lods.length - 1)];
    const recipes = listRecipes(fields, mesh, lod, context);
    const painted = paint.get(entity.pid);
    let vertexPaint = mesh.colors;
    if (painted !== undefined && painted.length === mesh.vertexCount) vertexPaint = painted;
    const world = worldVertices(mesh, placement);
    const target = {
        canvas,
        layer,
        recipe: null,
        winding: Math.sign(determinant(placement.matrix)),
        point: newPoint(placement),
        colour: [0, 0, 0],
        scratch: [0, 0, 0],
    };
    let triangles = 0;
    lod.forEach(({ triangles: indexes }, listIndex) => {
        target.recipe = recipes[listIndex];
        if (target.recipe.kind === 'skip') return;
        for (let at = 0; at + 2 < indexes.length; at += 3) {
            const corners = triangleCorners(
                [indexes[at], indexes[at + 1], indexes[at + 2]],
                world,
                mesh,
                vertexPaint,
                canvas,
            );
            rasterizeTriangle(target, corners);
            triangles++;
        }
    });
    return triangles;
}

// The mesh entities that are drawn, with their output layer
function drawnEntities(scenery) {
    const drawn = [];
    for (const entity of scenery.entities) {
        const fields = entity.fields;
        if (!fields['base.mesh'] || !MESH_TYPES.has(entity.type)) continue;
        if (hasFlag(fields, 'INVISIBLE')) continue;
        if (hiddenInMap(fields.overhead_map_flags)) continue;
        const layer = scenery.outputLayer(fields);
        if (layer < 0) continue;
        drawn.push({ pid: entity.pid, fields, layer });
    }
    return drawn;
}

function drawMeshes(scenery, context) {
    const meshes = new Map();
    let triangles = 0;
    let entities = 0;
    for (const entity of drawnEntities(scenery)) {
        const name = entity.fields['base.mesh'];
        if (!meshes.has(name)) meshes.set(name, readMesh(name));
        const mesh = meshes.get(name);
        if (mesh === null || mesh.lods.length === 0) continue;
        triangles += drawEntity(entity, mesh, context);
        entities++;
    }
    return { triangles, entities };
}

// Visible Wall_Sets: solid unit voxels with the entity colour, drawn at their top
function drawWalls(scenery, canvas) {
    const offsets = subSquareOffsets();
    let drawnSets = 0;
    for (const entity of scenery.entities) {
        if (entity.type !== 'Wall_Set') continue;
        const fields = entity.fields;
        if (hasFlag(fields, 'INVISIBLE') || fields.kind === 'OCEAN_HOLE') continue;
        const layer = scenery.outputLayer(fields);
        if (layer < 0) continue;
        const colour = vectorField(fields, 'base.tint_color_a.', [1, 1, 1]).map((value) => WALL_ALBEDO * value);
        const voxels = wallVoxels(fields);
        if (voxels.length === 0) continue;
        for (const [x, y, z] of voxels) {
            for (const [offsetX, offsetY] of offsets) {
                canvas.write(canvas.keyOf(layer, x + offsetX, y + offsetY), z + 1, colour);
            }
        }
        drawnSets++;
    }
    return drawnSets;
}

// OCEAN_HOLE Wall_Sets by the Ocean_Map they cut (ocean_hole_id)
function oceanHoles(scenery) {
    const holes = new Map();
    for (const entity of scenery.entities) {
        const fields = entity.fields;
        if (entity.type !== 'Wall_Set' || fields.kind !== 'OCEAN_HOLE' || !fields.ocean_hole_id) continue;
        const target = fields.ocean_hole_id[1];
        if (!holes.has(target)) holes.set(target, []);
        holes.get(target).push(fields);
    }
    return holes;
}

function packBits(values) {
    const bytes = new Uint8Array(Math.ceil(values.length / 8));
    values.forEach((value, k) => {
        if (value & 1) bytes[k >> 3] |= 1 << (k & 7);
    });
    return Buffer.from(bytes);
}

// The squares of a detect_holes map: all water, minus the voxels of the OCEAN_HOLE Wall_Sets that name it
function cutHoles(values, holes, origin, squares) {
    for (let k = 0; k < values.length; k++) values[k] |= 1;
    for (const hole of holes) {
        for (const [x, y] of wallVoxels(hole)) {
            const i = Math.round(x - origin[0]);
            const j = Math.round(y - origin[1]);
            if (i >= 0 && i < squares[0] && j >= 0 && j < squares[1]) values[i + j * squares[0]] &= ~1;
        }
    }
}

// Water over the sub-squares of each Ocean_Map square with bit 0 set: it covers anything lower, and where the floor is
// just below the surface it is lightened like the game's shore foam
function drawWater(scenery, canvas, materials) {
    const depthColour = (materials.resolve(WATER_MATERIAL) ?? {}).depth_color ?? DEFAULT_DEPTH_COLOUR;
    const waterColour = [0, 1, 2].map((i) => WATER_DEPTH_WEIGHT * depthColour[i] + WATER_SKY[i]);
    const holes = oceanHoles(scenery);
    const offsets = subSquareOffsets();
    const oceans = [];
    let waterCount = 0;
    for (const entity of scenery.entities) {
        if (entity.type !== 'Ocean_Map') continue;
        const fields = entity.fields;
        const layer = scenery.outputLayer(fields);
        if (layer < 0) continue;
        if (!scenery.existsAtLoad(fields)) continue;
        const squares = [get(fields, 'grid.squares_x', 0), get(fields, 'grid.squares_y', 0)];
        const values = Int32Array.from(fields.ocean_values ?? []);
        if (values.length !== squares[0] * squares[1]) continue;
        // an `oceans` entry and the drawing map square k to (x0 + k % sx, y0 + floor(k / sx)): an unrotated map only
        if (!isAxisAligned(fields)) {
            throw new Error(`Ocean_Map ${entity.id} is rotated; map.json oceans cannot hold it`);
        }
        const origin = ['x', 'y'].map(
            (axis) => get(fields, `base.position.${axis}`, 0) + get(fields, `grid.corner.${axis}`, 0),
        );
        if (fields.detect_holes) cutHoles(values, holes.get(entity.pid) ?? [], origin, squares);
        // the ocean mesh sits `sink` below the map's z; a negative sink (the type default, -1) means 0.1
        const sink = get(fields, 'sink', -1);
        let surface = get(fields, 'base.position.z', 0) - 0.1;
        if (sink >= 0) surface = get(fields, 'base.position.z', 0) - sink;
        if (fields.kind !== 'PLAYER_BLOCKING_ONLY') {
            oceans.push({
                pid: entity.pid,
                layer,
                x0: Math.round(origin[0]),
                y0: Math.round(origin[1]),
                sx: squares[0],
                sy: squares[1],
                zw: roundTo(surface, 3),
                water: packBits(values).toString('base64'),
            });
        }
        waterCount += floodSquares(canvas, { layer, values, squares, origin, surface, waterColour, offsets });
    }
    return { oceans, waterCount, waterColour };
}

// The water colour over a floor `mix` of the way up the shallow band (0 = deep or no floor, 1 = at the surface)
function shoreColour(waterColour, floorColour, mix) {
    return [0, 1, 2].map((channel) => {
        const lit = waterColour[channel] * (1 - FOAM_MIX * mix) + FOAM[channel] * FOAM_MIX * mix;
        return lit * (1 - FLOOR_MIX * mix) + floorColour[channel] * FLOOR_MIX * mix;
    });
}

function floodSquares(canvas, map) {
    const { layer, values, squares, origin, surface, waterColour, offsets } = map;
    const keys = [];
    for (let j = 0; j < squares[1]; j++) {
        for (let i = 0; i < squares[0]; i++) {
            if (!(values[j * squares[0] + i] & 1)) continue;
            for (const [offsetX, offsetY] of offsets) {
                keys.push(canvas.keyOf(layer, origin[0] + i + offsetX, origin[1] + j + offsetY));
            }
        }
    }
    const shallowStart = surface - SHALLOW_DEPTH;
    const updates = [];
    for (const key of keys) {
        const height = canvas.heights[key];
        if (!(height < surface)) continue;
        let mix = 0;
        if (Number.isFinite(height)) mix = clamp((height - shallowStart) / SHALLOW_DEPTH, 0, 1);
        const floorColour = canvas.colours.subarray(key * 3, key * 3 + 3);
        updates.push([key, shoreColour(waterColour, floorColour, mix)]);
    }
    for (const [key, colour] of updates) {
        canvas.colours.set(colour, key * 3);
        canvas.heights[key] = surface;
    }
    return updates.length;
}

// Soft shoulder above the knee so that bright tiles keep some detail instead of clipping
function tone(value) {
    if (value < TONE_KNEE) return value;
    return TONE_KNEE + (1 - TONE_KNEE) * (1 - Math.exp(-(value - TONE_KNEE) / (1 - TONE_KNEE)));
}

function linearToSrgb(value) {
    const clipped = clamp(value, 0, 1);
    if (clipped <= 0.0031308) return clipped * 12.92;
    return 1.055 * clipped ** (1 / 2.4) - 0.055;
}

// The displayed 0..255 value of one albedo channel
function displayed(albedo, channel) {
    return Math.round(linearToSrgb(tone(albedo * EXPOSURE[channel])) * 255);
}

// The z range a layer's heights are stored over: the layer table's bounds, or the drawn heights where it is unbounded
function heightRange(range, drawn) {
    let [low, top] = range;
    if (!Number.isFinite(low)) {
        low = 0;
        if (drawn.length) low = Math.floor(Math.min(...drawn));
    }
    if (!Number.isFinite(top)) {
        top = low + 1;
        if (drawn.length) top = Math.ceil(Math.max(...drawn));
    }
    return [low, top];
}

// One output layer: the mean colour of each square's covered sub-squares and the height of the highest one
function composeLayer(canvas, layerIndex, range) {
    const { width, height } = canvas;
    const squareCount = width * height;
    const sums = new Float64Array(squareCount * 3);
    const covered = new Int32Array(squareCount);
    const highest = new Float64Array(squareCount).fill(-Infinity);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const square = y * width + x;
            for (let subY = 0; subY < SUB; subY++) {
                for (let subX = 0; subX < SUB; subX++) {
                    const key = canvas.keyAt(layerIndex, x * SUB + subX, y * SUB + subY);
                    const z = canvas.heights[key];
                    if (!Number.isFinite(z)) continue;
                    covered[square]++;
                    if (z > highest[square]) highest[square] = z;
                    for (let channel = 0; channel < 3; channel++) {
                        sums[square * 3 + channel] += canvas.colours[key * 3 + channel];
                    }
                }
            }
        }
    }
    const drawn = [];
    for (let square = 0; square < squareCount; square++) {
        if (covered[square] >= MIN_COVERED) drawn.push(highest[square]);
    }
    const [low, top] = heightRange(range, drawn);
    const scale = (top - low) / HEIGHT_STEPS;
    const cells = Buffer.alloc(squareCount * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const square = y * width + x;
            if (covered[square] < MIN_COVERED) continue;
            const stored = Math.round((highest[square] - low) / scale);
            const row = height - 1 - y;
            const offset = (row * width + x) * 4;
            for (let channel = 0; channel < 3; channel++) {
                cells[offset + channel] = displayed(sums[square * 3 + channel] / covered[square], channel);
            }
            cells[offset + 3] = 1 + clamp(stored, 0, HEIGHT_STEPS);
        }
    }
    return { cells, low, top, scale, filled: drawn.length };
}

function buildMap() {
    const levels = JSON.parse(readFileSync(paths.data('levels.json'), 'utf8'));
    const settings = levels.levels.find((level) => level.name === 'overworld').settings;
    const corner = [settings['grid.corner.x'], settings['grid.corner.y']];
    const size = [settings['grid.squares_x'], settings['grid.squares_y']];
    const pkg = new Package();
    const scenery = new Scenery(pkg);
    pkg.close();
    const canvas = new Canvas(corner, size);
    const paint = readPaint('overworld');
    const materials = new Materials();
    const context = { canvas, paint, materials, textures: new Textures(), recipeCache: new Map() };
    console.log('layer table', scenery.table);
    console.log(`loaded ${scenery.entities.length} entities, ${paint.size} painted`);

    const { triangles, entities } = drawMeshes(scenery, context);
    console.log(`${entities} mesh entities, ${triangles} triangles`);
    const walls = drawWalls(scenery, canvas);
    console.log('wall sets', walls);
    const { oceans, waterCount, waterColour } = drawWater(scenery, canvas, materials);
    console.log('water sub-squares', waterCount);

    const waterRgb = waterColour.map(displayed);
    const out = { corner, size, layers: [], water_rgb: waterRgb, oceans };
    LAYERS.forEach((layer, layerIndex) => {
        const composed = composeLayer(canvas, layerIndex, scenery.table[layer.fog]);
        out.layers.push({
            key: layer.key,
            name: layer.name,
            z: [roundTo(composed.low, 3), roundTo(composed.top, 3)],
            zbase: roundTo(composed.low, 3),
            zscale: roundTo(composed.scale, 6),
            cells: composed.cells.toString('base64'),
        });
        console.log(layer.key, 'squares', composed.filled, 'z', composed.low, composed.top);
    });
    writeJsonAtomic(paths.data('map.json'), out);
}

paths.parseCommandLine();
buildMap();
