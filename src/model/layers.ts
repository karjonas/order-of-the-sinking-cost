// The overworld's layers (ground, sky, underworld) and its wrapping (WORLD.md "Ground layers", STATE.md "Fog of war")
import { PROG } from '../data.ts';

/** The fog's layers by their index in the level data. */
export const FOG_LAYER_KEYS = ['ground', 'underworld', 'sky'];

/** The layers in the order the page lists them. */
export const AREA_LAYERS = ['ground', 'sky', 'underworld'];

/** The map layer a height is on. */
export function mapLayerOf(z: number): string {
    const layers = PROG.map.layers;
    return (layers.find((layer) => z >= layer.z[0] && z < layer.z[1]) || layers[1] || layers[0]).key;
}

export const layerName = (key: string): string =>
    PROG.map?.layers.find((layer) => layer.key === key)?.name || key[0].toUpperCase() + key.slice(1);

/** The offset `delta` on a circle of length `size`, taken the short way round: in (-size/2, size/2]. */
export const wrapDelta = (delta: number, size: number): number => delta - Math.ceil(delta / size - 0.5) * size;
