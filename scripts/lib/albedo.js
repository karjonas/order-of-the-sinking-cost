// How the map builder colours a point of a mesh surface: the albedo each material's shader computes, read from its
// textures at the point's UV (docs/GAMEDATA.md "data/materials.package")
import { modulo } from './math.js';
import { textureImage } from './render-assets.js';

// mip size the surface textures are read at, and the world-space tint maps
const SURFACE_RESOLUTION = 64;
const TINT_MAP_RESOLUTION = 512;
// a cut-out texel this transparent or more is a hole
const OPACITY_CUTOFF = 0.5;
// the colour of a layer whose texture is missing, and the blend weight without a MASKS texture
const MISSING_TEXTURE = [0.5, 0.5, 0.5];
const DEFAULT_BLEND_MASK = 0.5;

// shader -> how its albedo is formed
const BLEND_SHADERS = new Set(['blended2', 'blended2_dissolve', 'freezer']);
const GROUND_SHADERS = new Set(['ground_general', 'ground_general_dissolve']);
const SINGLE_SHADERS = new Set([
    'basic',
    'basic_masked',
    'foliage',
    'foliage_masked',
    'rocks_general',
    'default',
    'floor_tile',
    'basic_rover',
    'guy',
    'gem',
    'crystal_general',
    'dragon_iridescent_solid',
    'dragon_iridescent_scales',
    'dragon_egg',
    'mirror_panel',
    'mirror_panel_magic',
]);
const MASKED_SHADERS = new Set(['basic_masked', 'foliage', 'foliage_masked']);
// leaf cards are seen from both sides; every other surface only from its front
const TWO_SIDED_SHADERS = new Set(['foliage', 'foliage_masked']);
const DIFFUSE_KEYS = ['DIFFR_tex', 'DIFFR_A', 'diffuse_texture', 'color_map', 'DIFF_Tex', 'Texture'];

function isText(value) {
    return typeof value === 'string';
}

// A material value that is set: not missing, false, zero or empty
function isSet(value) {
    return value !== undefined && value !== null && value !== false && value !== 0 && value !== '';
}

function valueOr(value, fallback) {
    if (isSet(value)) return value;
    return fallback;
}

// The linear-light value of an sRGB-encoded channel in 0..1
export function srgbToLinear(value) {
    if (value <= 0.04045) return value / 12.92;
    return ((value + 0.055) / 1.055) ** 2.4;
}

// An image { width, height, channels, data } of one texture, its colour channels converted to linear
function linearImage(image) {
    const pixels = image.width * image.height;
    const data = new Float32Array(pixels * 3);
    for (let i = 0; i < pixels; i++) {
        for (let channel = 0; channel < 3; channel++) data[i * 3 + channel] = srgbToLinear(image.data[i * 4 + channel]);
    }
    return { width: image.width, height: image.height, channels: 3, data };
}

function rawImage(image) {
    return { width: image.width, height: image.height, channels: 4, data: image.data };
}

// The texture a material names, converted by `convert`, or null when the name is not a texture name or the file is
// missing
function readImage(name, resolution, convert) {
    if (!isText(name) || !name) return null;
    const image = textureImage(name, resolution);
    if (image === null) return null;
    return convert(image);
}

// Textures by name, read from the game's data-pc folder once each
export class Textures {
    constructor() {
        this.colourImages = new Map();
        this.rawImages = new Map();
        this.tintMaps = new Map();
    }

    // Linear RGB of a colour texture
    colour(name) {
        if (!this.colourImages.has(name)) this.colourImages.set(name, readImage(name, SURFACE_RESOLUTION, linearImage));
        return this.colourImages.get(name);
    }

    // The stored RGBA values of a mask or opacity texture
    raw(name) {
        if (!this.rawImages.has(name)) this.rawImages.set(name, readImage(name, SURFACE_RESOLUTION, rawImage));
        return this.rawImages.get(name);
    }

    // Linear RGB of a world-space tint map, at a higher resolution than the surface textures
    tintMap(name) {
        if (!this.tintMaps.has(name)) this.tintMaps.set(name, readImage(name, TINT_MAP_RESOLUTION, linearImage));
        return this.tintMaps.get(name);
    }
}

// The index of the first value of the texel under (u, v); the texture repeats in both directions
function texelIndex(image, u, v) {
    const column = modulo(Math.floor(u * image.width), image.width);
    const row = modulo(Math.floor(v * image.height), image.height);
    return (row * image.width + column) * image.channels;
}

// One channel of a raw image at (u, v)
function channelAt(source, u, v) {
    return source.image.data[texelIndex(source.image, u, v) + source.channel];
}

// A layer of a material: its texture (or a fixed colour) times the material tint, and whether the entity tint applies
function layerOf(texture, colour, tint, usesEntity) {
    return { texture, colour, tint, usesEntity };
}

function colourOf(material, key) {
    const value = material[key];
    if (Array.isArray(value) && value.length >= 3) return value.slice(0, 3);
    return [1, 1, 1];
}

// The texture a material key names, 'default' when the key is missing
function namedTexture(textures, material, key) {
    let name = 'default';
    if (isText(material[key])) name = material[key];
    return textures.colour(name);
}

// [texture, channel] of a raw texture channel, or null when the texture is missing
function channelSource(textures, name, channel) {
    const image = textures.raw(name);
    if (image === null) return null;
    return { image, channel: Math.trunc(valueOr(channel, 0)) };
}

// The opacity channel of a cut-out material: OPAC_tex, else MASKS_tex, else the diffuse texture's alpha
function opacityOf(textures, material, diffuseKey) {
    let source = material[diffuseKey];
    if (isText(material.OPAC_tex)) source = material.OPAC_tex;
    else if (isText(material.MASKS_tex)) source = material.MASKS_tex;
    if (!source) return null;
    let channel = 3;
    if (source === material.OPAC_tex) channel = 0;
    if (material.opacity_channel !== undefined) channel = material.opacity_channel;
    return channelSource(textures, source, channel);
}

function kindOf(shader) {
    if (BLEND_SHADERS.has(shader)) return 'blend';
    if (GROUND_SHADERS.has(shader)) return 'ground';
    if (SINGLE_SHADERS.has(shader)) return 'single';
    return 'skip';
}

// The texture layers of a one-layer shader; crystal_general shows its fixed core and fracture colours
function singleLayers(textures, material, recipe) {
    const tint = colourOf(material, 'tint_color_A');
    if (material.shader === 'crystal_general') {
        const core = colourOf(material, 'color_core');
        const fracture = colourOf(material, 'fracture_color');
        const colour = core.map((value, i) => (value + fracture[i]) / 2);
        recipe.layerA = layerOf(null, colour, tint, true);
    } else {
        const key = DIFFUSE_KEYS.find((candidate) => isText(material[candidate])) ?? null;
        const texture = key ? namedTexture(textures, material, key) : null;
        recipe.layerA = layerOf(texture, MISSING_TEXTURE, tint, true);
        if (MASKED_SHADERS.has(material.shader)) recipe.opacity = opacityOf(textures, material, key);
    }
    recipe.layerB = recipe.layerA;
}

function blendLayers(textures, material, recipe) {
    let usesEntityA = true;
    let usesEntityB = true;
    let blendChannel = material.masks_channel;
    if (recipe.kind === 'ground') {
        usesEntityA = Boolean(material.use_tint_colors_A);
        usesEntityB = Boolean(material.use_tint_colors_B);
        blendChannel = material.MASKS_blend_channel;
        recipe.tintMaps = [textures.tintMap(material.tint_map_A), textures.tintMap(material.tint_map_B)];
        recipe.tintMapParameters = {
            mode: valueOr(material.tint_align_mode, 0),
            offsetX: valueOr(material.tint_map_offset_X, 0),
            offsetY: valueOr(material.tint_map_offset_Y, 0),
            size: valueOr(material.tint_map_size_XY, 1),
            rotation: valueOr(material.tint_map_rotation, 0),
        };
    }
    const textureA = namedTexture(textures, material, 'DIFFR_A');
    const textureB = namedTexture(textures, material, 'DIFFR_B');
    recipe.layerA = layerOf(textureA, MISSING_TEXTURE, colourOf(material, 'tint_color_A'), usesEntityA);
    recipe.layerB = layerOf(textureB, MISSING_TEXTURE, colourOf(material, 'tint_color_B'), usesEntityB);
    recipe.blendMask = channelSource(textures, material.MASKS_tex, blendChannel);
    let hardness = 1;
    if (material.blend_hardness !== undefined) hardness = Number(valueOr(material.blend_hardness, 0));
    recipe.hardness = Math.max(0.001, hardness);
}

// How a material colours a point: kind 'skip' (not drawn), 'single', 'blend' or 'ground', and whether its back faces
// are drawn (twoSided)
function buildRecipe(materials, textures, name) {
    const material = materials.resolve(name);
    const kind = kindOf(material ? material.shader : null);
    if (kind === 'skip') return { kind };
    const recipe = { kind, opacity: null, blendMask: null, hardness: 1, tintMaps: null, tintMask: null };
    if (kind === 'single') singleLayers(textures, material, recipe);
    else blendLayers(textures, material, recipe);
    // pure black shadow-caster planes (material 'Black'), not seen from above
    if (kind === 'single' && !recipe.layerA.tint.some(Boolean)) return { kind: 'skip' };
    recipe.swap = Boolean(material.swap_entity_colors);
    recipe.twoSided = TWO_SIDED_SHADERS.has(material.shader);
    if (material.use_tint_mask)
        recipe.tintMask = channelSource(textures, material.tint_mask_tex, material.tint_mask_channel);
    return recipe;
}

export function materialRecipe(materials, textures, name, cache) {
    if (!cache.has(name)) cache.set(name, buildRecipe(materials, textures, name));
    return cache.get(name);
}

// The linear colour of the tint map under a world position, as the offset of its r, g, b in the map's data. The map
// lies over the world in one of three alignments (`mode`): a 24 m tile, an 84.67 m tile, or free with an offset, size
// and rotation.
function tintMapIndex(image, parameters, x, y) {
    const { mode, offsetX, offsetY, size, rotation } = parameters;
    if (mode === 1) return texelIndex(image, (x + 0.5) / 24, (-0.5 - y) / 24);
    if (mode === 2) return texelIndex(image, (x + 5) / 84.666667, (-5 - y) / 84.666667);
    const angle = (rotation * Math.PI) / 2;
    const rotatedX = x * Math.cos(angle) + y * Math.sin(angle);
    const rotatedY = y * Math.cos(angle) - x * Math.sin(angle);
    return texelIndex(image, (rotatedX - offsetX) / size, (offsetY - rotatedY) / size);
}

// One layer's albedo at (u, v) into out[0..2]: texture x material tint, the tint-masked part times the entity colour
function layerColour(layer, entityColour, tintMask, u, v, out) {
    let source = layer.colour;
    let at = 0;
    if (layer.texture !== null) {
        source = layer.texture.data;
        at = texelIndex(layer.texture, u, v);
    }
    for (let channel = 0; channel < 3; channel++) {
        let value = source[at + channel] * layer.tint[channel];
        if (layer.usesEntity) value *= 1 - tintMask + tintMask * entityColour[channel];
        out[channel] = value;
    }
}

function applyTintMap(image, parameters, x, y, out) {
    if (image === null) return;
    const at = tintMapIndex(image, parameters, x, y);
    for (let channel = 0; channel < 3; channel++) out[channel] *= image.data[at + channel];
}

// The albedo of a surface point into out[0..2]. `point` holds the UV, the red vertex paint, the world x, y and the
// entity's two tint colours. False when the point is a hole of a cut-out material.
export function shadePoint(recipe, point, out, scratch) {
    const { u, v } = point;
    if (recipe.opacity !== null && channelAt(recipe.opacity, u, v) < OPACITY_CUTOFF) return false;
    let tintMask = 1;
    if (recipe.tintMask !== null) tintMask = channelAt(recipe.tintMask, u, v);
    let entityA = point.tintA;
    let entityB = point.tintB;
    if (recipe.swap) {
        entityA = point.tintB;
        entityB = point.tintA;
    }
    layerColour(recipe.layerA, entityA, tintMask, u, v, out);
    if (recipe.kind === 'single') return true;
    layerColour(recipe.layerB, entityB, tintMask, u, v, scratch);
    if (recipe.tintMaps !== null) {
        applyTintMap(recipe.tintMaps[0], recipe.tintMapParameters, point.x, point.y, out);
        applyTintMap(recipe.tintMaps[1], recipe.tintMapParameters, point.x, point.y, scratch);
    }
    let mask = DEFAULT_BLEND_MASK;
    if (recipe.blendMask !== null) mask = channelAt(recipe.blendMask, u, v);
    const red = point.red;
    const blend = Math.min(Math.max(red + recipe.hardness * (red + mask - 1), 0), 1);
    for (let channel = 0; channel < 3; channel++) out[channel] += (scratch[channel] - out[channel]) * blend;
    return true;
}
