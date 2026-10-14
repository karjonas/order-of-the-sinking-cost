// The page's data: the entity schema and data/progress.json, inlined at build time, and the world cells
import SCHEMA from '../data/schema.json' with { type: 'json' };
import PROG from '../data/progress.json' with { type: 'json' };
export const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// data/world.json cells (zlib + base64), unpacked once at load
export const inflate = async (b64) =>
    new Uint8Array(
        await new Response(
            new Blob([fromBase64(b64)]).stream().pipeThrough(new DecompressionStream('deflate')),
        ).arrayBuffer(),
    );
export let WORLD = null;
export const worldReady = PROG.world
    ? Promise.all([inflate(PROG.world.solid), inflate(PROG.world.group_cells), inflate(PROG.world.water)])
          .then(([solid, groups, water]) => {
              WORLD = { solid, groups, water };
          })
          .catch((err) => console.error('world data', err))
    : Promise.resolve();
export { SCHEMA, PROG };
