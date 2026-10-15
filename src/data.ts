// The page's data: the entity schema and data/progress.json, inlined at build time, and the world cells
import SCHEMA from '../data/schema.json' with { type: 'json' };
import PROG from '../data/progress.json' with { type: 'json' };

/** The bytes of a base64 string. */
export function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
    const text = atob(base64);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
}

/** The bytes of a zlib stream given as base64. */
export const inflate = async (base64: string): Promise<Uint8Array> => {
    const compressed = new Blob([fromBase64(base64)]);
    const inflated = compressed.stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(inflated).arrayBuffer());
};

/** The world cells of data/world.json, unpacked: static solid voxels, Wall_Set group cells and water per column. */
export interface WorldCells {
    solid: Uint8Array;
    groups: Uint8Array;
    water: Uint8Array;
}

/** null until `worldReady` settles. */
export let WORLD: WorldCells | null = null;

async function unpackWorld(): Promise<void> {
    const world = PROG.world;
    if (!world) return;

    try {
        const [solid, groups, water] = await Promise.all([
            inflate(world.solid),
            inflate(world.group_cells),
            inflate(world.water),
        ]);
        WORLD = { solid, groups, water };
    } catch (error) {
        console.error('world data', error);
    }
}

/** Settles once the world cells are unpacked (or failed to be). */
export const worldReady: Promise<void> = unpackWorld();

export { SCHEMA, PROG };
