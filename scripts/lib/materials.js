// The game's materials (data/materials.package, format in docs/GAMEDATA.md, Render assets) turned into a colour
// function per material, for the icon renderer. Lighting, normal maps and reflections are not modelled.
import * as paths from './paths.js';
import { Archive } from './archive.js';
import { srgbToLinear } from './textures.js';

const WHITE = [1, 1, 1];
const ADDITIVE_SHADERS = new Set(['additive', 'unlit_additive']);
const BLENDED_SHADERS = new Set(['blended2', 'freezer', 'ground_general']);

function parseValue(text) {
    if (text.startsWith('"')) return text.slice(1, -1);
    if (text.startsWith('(')) return text.slice(1, -1).trim().split(/\s+/).map(Number);
    if (text === 'true') return true;
    if (text === 'false') return false;
    return Number(text);
}

function baseName(path) {
    return path
        .split('/')
        .pop()
        .replace(/\.material$/, '');
}

function rgbOf(value, fallback) {
    if (!Array.isArray(value)) return fallback;
    return [value[0], value[1], value[2]];
}

function multiply(a, b) {
    return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

function mix(a, b, weight) {
    return [a[0] + (b[0] - a[0]) * weight, a[1] + (b[1] - a[1]) * weight, a[2] + (b[2] - a[2]) * weight];
}

// The largest channel scaled to 1: the hue of a colour whose brightness is an intensity
export function normalized(color) {
    const largest = Math.max(color[0], color[1], color[2], 1e-6);
    return [color[0] / largest, color[1] / largest, color[2] / largest];
}

export class Materials {
    constructor(textures) {
        this.textures = textures;
        this.archive = new Archive(paths.game('data', 'materials.package'));
        this.paths = new Map();
        for (const name of this.archive.files.keys()) this.paths.set(baseName(name), name);
        this.cache = new Map();
        this.scratch = [0, 0, 0, 0];
    }

    close() {
        this.archive.close();
    }

    // The keys of a material with its parents' keys it does not set; {} for an unknown name
    get(name) {
        if (this.cache.has(name)) return this.cache.get(name);
        const path = this.paths.get(name);
        let keys = {};
        if (path) {
            for (const line of this.archive.read(path).toString('utf8').split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const space = trimmed.indexOf(' ');
                if (space < 0) continue;
                keys[trimmed.slice(0, space)] = parseValue(trimmed.slice(space + 1).trim());
            }
            if (keys.parent) keys = { ...this.get(baseName(keys.parent)), ...keys };
        }
        this.cache.set(name, keys);
        return keys;
    }

    // The mask value of a tint mask texture at (u, v): its channel `channel` (0 = red) as 0..1
    maskAt(textureName, channel, u, v, footprint) {
        const texture = this.textures.get(textureName);
        if (!texture) return 1;
        texture.texel(u, v, footprint, this.scratch);
        return this.scratch[channel] / 255;
    }

    colorAt(textureName, u, v, footprint) {
        const texture = this.textures.get(textureName);
        if (!texture) return WHITE;
        texture.texel(u, v, footprint, this.scratch);
        return [srgbToLinear(this.scratch[0]), srgbToLinear(this.scratch[1]), srgbToLinear(this.scratch[2])];
    }

    alphaAt(textureName, u, v, footprint) {
        const texture = this.textures.get(textureName);
        if (!texture) return 1;
        texture.texel(u, v, footprint, this.scratch);
        return this.scratch[3] / 255;
    }

    // How one triangle list is drawn: { kind: 'solid' | 'glow' | 'glass', color(u, v, paint, footprint) -> [r, g, b] }
    // `entity` holds tintA and tintB (the entity's tint colours) and effectColor (the entity's runtime colour, or null).
    // A solid colour is the albedo; a glow is emitted light, not lit; glass is a translucent solid.
    shading(materialName, entity) {
        const material = this.get(materialName);
        const shader = material.shader ?? '';
        const glows = ADDITIVE_SHADERS.has(shader) || shader === 'crystal_general';
        if (glows && entity.noGlow) return null;
        if (ADDITIVE_SHADERS.has(shader)) return this.glowShading(material, entity);
        if (shader === 'crystal_general') return this.glassShading(material, entity);
        if (shader === 'guy') return this.characterShading(material);

        let ownA = entity.tintA;
        let ownB = entity.tintB;
        if (material.swap_entity_colors) {
            ownA = entity.tintB;
            ownB = entity.tintA;
        }
        const tintA = rgbOf(material.tint_color_A, WHITE);
        const tintB = rgbOf(material.tint_color_B, WHITE);
        const useMask = material.use_tint_mask === true;
        const maskTexture = material.tint_mask_tex ?? 'white';
        const maskChannel = material.tint_mask_channel ?? 0;
        const maskOf = (u, v, footprint) => {
            if (!useMask) return 1;
            return this.maskAt(maskTexture, maskChannel, u, v, footprint);
        };

        if (BLENDED_SHADERS.has(shader)) {
            const layerA = material.DIFFR_A ?? 'white';
            const layerB = material.DIFFR_B ?? 'white';
            return {
                kind: 'solid',
                color: (u, v, paint, footprint) => {
                    const mask = maskOf(u, v, footprint);
                    const entityA = mix(WHITE, ownA, mask);
                    const entityB = mix(WHITE, ownB, mask);
                    const colorA = multiply(multiply(this.colorAt(layerA, u, v, footprint), tintA), entityA);
                    const colorB = multiply(multiply(this.colorAt(layerB, u, v, footprint), tintB), entityB);
                    return mix(colorA, colorB, paint);
                },
            };
        }

        if (material.relative_to_ec === true && entity.effectColor && (material.DIFFR_tex ?? 'white') === 'white') {
            const hue = normalized(entity.effectColor);
            return { kind: 'glow', color: () => hue };
        }

        let textureName = material.DIFFR_tex ?? 'white';
        if (material.color_map !== undefined) textureName = material.color_map;
        return {
            kind: 'solid',
            color: (u, v, paint, footprint) => {
                const mask = maskOf(u, v, footprint);
                const entityColor = mix(WHITE, ownA, mask);
                return multiply(multiply(this.colorAt(textureName, u, v, footprint), tintA), entityColor);
            },
        };
    }

    // A character is its palette texture times color_modulate; the entity's colours only pick palette entries in-game
    characterShading(material) {
        const palette = material.color_map ?? 'white';
        const modulate = rgbOf(material.color_modulate, WHITE);
        return {
            kind: 'solid',
            color: (u, v, paint, footprint) => multiply(this.colorAt(palette, u, v, footprint), modulate),
        };
    }

    glowShading(material, entity) {
        let hue = normalized(rgbOf(material.tint_color, WHITE));
        if (entity.effectColor) hue = normalized(entity.effectColor);
        return { kind: 'glow', color: () => hue };
    }

    glassShading(material, entity) {
        let core = rgbOf(material.color_core, WHITE);
        if (entity.effectColor) core = normalized(entity.effectColor);
        return { kind: 'glass', color: () => core };
    }
}
