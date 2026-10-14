// Fog of war: the regions a save has cleared, from data/fog.json via data/progress.json (STATE.md "Fog of war")
import { PROG } from './data.js';
import { decodeBlob } from './save.js';
import { historyEntry } from './files.js';
import { mod } from './walk/cells.js';
import { FOG_LAYER_KEYS } from './model/layers.js';

const fogCache = new WeakMap();
// the region states of each fog entity in the history, by pid: the history's own, raised by its newest Fog_Of_War
// diffs
function regionStates(history) {
    const pids = new Set([...PROG.fog.primary, ...PROG.fog.boxes].map((fog) => fog.pid)),
        states = new Map([...(history.fogStates || [])].map(([pid, regions]) => [pid, regions.slice()]));
    for (const action of history.actions) {
        const pid = action.pid >>> 0;
        if (!pids.has(pid) || history.types[action.etype]?.name !== 'Fog_Of_War') continue;
        let diff;
        try {
            diff = decodeBlob(action.blob, 'Fog_Of_War', action.type === 1);
        } catch {
            continue;
        }
        const raw = diff.fields.find((field) => field.f.n === 'region_states')?.new?.raw;
        if (!raw) continue;
        const current = states.get(pid);
        // kept history only moves towards cleared, so the element-wise max is the current state
        if (!current || current.length !== raw.length) states.set(pid, Uint8Array.from(raw));
        else
            raw.forEach((value, index) => {
                if (value > current[index]) current[index] = value;
            });
    }
    return states;
}
// Region states per fog entity, from the newest Fog_Of_War diffs in overworld.history; null without that file.
export function fogOf(camp) {
    if (!PROG.fog) return null;
    const historyFile = historyEntry(camp);
    if (!historyFile) return null;
    if (fogCache.has(historyFile.parsed)) return fogCache.get(historyFile.parsed);
    const states = regionStates(historyFile.parsed);
    const grid = PROG.fog.grid,
        [cornerX, cornerY] = grid.corner,
        [screenWidth, screenHeight] = grid.screen,
        [columns, rows] = grid.count,
        regionCount = columns * rows;
    const regionAt = (x, y) =>
        mod(Math.floor((x - cornerX) / screenWidth), columns) +
        columns * mod(Math.floor((y - cornerY) / screenHeight), rows);
    const primary = PROG.fog.primary.map((fog) => {
        const regions = states.get(fog.pid);
        return { layer: fog.layer, st: regions && regions.length === regionCount ? regions : null };
    });
    const boxes = PROG.fog.boxes.map((box) => ({ ...box, filled: !(states.get(box.pid)?.[0] > 0) }));
    const fogged = (layer, region) => {
        const layerFog = primary.find((fog) => fog.layer === layer);
        return !!layerFog && (!layerFog.st || layerFog.st[region] === 0);
    };
    const inXY = (box, x, y) => x >= box.min[0] && x < box.max[0] && y >= box.min[1] && y < box.max[1];
    const inBox = (layer, x, y, z) =>
        boxes.some((box) => box.filled && box.layer === layer && inXY(box, x, y) && z >= box.min[2] && z < box.max[2]);
    const regionRect = (region) => [
        cornerX + screenWidth * (region % columns),
        cornerY + screenHeight * Math.floor(region / columns),
        screenWidth,
        screenHeight,
    ];
    const out = {
        // map layer keys with at least one fog region cleared
        knownLayers: () =>
            FOG_LAYER_KEYS.filter((key, layer) =>
                primary.some((fog) => fog.layer === layer && fog.st?.some((value) => value > 0)),
            ),
        levelHidden: (name, position) => {
            const levelRegion = PROG.fog.levels[name];
            if (!levelRegion) return false;
            if (fogged(levelRegion[0], levelRegion[1])) return true;
            return !!position && inBox(levelRegion[0], position[0], position[1], position[2]);
        },
        // whether a world point of one map layer lies under fog
        at: (key, x, y, z) => {
            const layer = FOG_LAYER_KEYS.indexOf(key);
            return layer >= 0 && (fogged(layer, regionAt(x, y)) || inBox(layer, x, y, z));
        },
        // fogged rectangles of one map layer, in world coordinates
        rects: (key) => {
            const layer = FOG_LAYER_KEYS.indexOf(key);
            if (layer < 0) return [];
            const rects = [];
            for (let region = 0; region < regionCount; region++)
                if (fogged(layer, region)) rects.push(regionRect(region));
            for (const box of boxes)
                if (box.filled && box.layer === layer)
                    rects.push([box.min[0], box.min[1], box.max[0] - box.min[0], box.max[1] - box.min[1]]);
            return rects;
        },
        // cleared regions of one map layer, in world coordinates
        open: (key) => {
            const layer = FOG_LAYER_KEYS.indexOf(key),
                rects = [];
            if (layer < 0) return rects;
            for (let region = 0; region < regionCount; region++)
                if (!fogged(layer, region)) rects.push(regionRect(region));
            return rects;
        },
        // whether a square of one map layer is fogged at any height
        cover: (key, x, y) => {
            const layer = FOG_LAYER_KEYS.indexOf(key);
            if (layer < 0) return false;
            if (fogged(layer, regionAt(x, y))) return true;
            return boxes.some((box) => box.filled && box.layer === layer && inXY(box, x, y));
        },
    };
    fogCache.set(historyFile.parsed, out);
    return out;
}
// with no fog data, everything but what the save shows the player has done counts as fogged
export const NO_FOG = {
    knownLayers: () => ['ground'],
    levelHidden: () => true,
    at: () => true,
    open: () => [],
    cover: () => true,
    rects: () => {
        const [cornerX, cornerY] = PROG.map?.corner || [0, 0],
            [width, height] = PROG.map?.size || [0, 0];
        return [[cornerX, cornerY, width, height]];
    },
};
