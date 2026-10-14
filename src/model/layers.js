// The overworld's layers (ground, sky, underworld) and its wrapping (WORLD.md "Ground layers", STATE.md "Fog of war")
import { PROG } from '../data.js';

// the fog's layers by their index in the level data
export const FOG_LAYER_KEYS = ['ground', 'underworld', 'sky'];
// the layers in the order the page lists them
export const AREA_LAYERS = ['ground', 'sky', 'underworld'];

// the map layer a height is on
export function mapLayerOf(z) {
    const ls = PROG.map.layers;
    return (ls.find((l) => z >= l.z[0] && z < l.z[1]) || ls[1] || ls[0]).key;
}

export const layerName = (key) =>
    PROG.map?.layers.find((l) => l.key === key)?.name || key[0].toUpperCase() + key.slice(1);

// the offset `delta` on a circle of length `size`, taken the short way round: in (-size/2, size/2]
export const wrapDelta = (delta, size) => delta - Math.ceil(delta / size - 0.5) * size;
