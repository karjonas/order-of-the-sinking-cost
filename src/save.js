// Save files: Status.sokoban_status, overworld.history and entity diff blobs
import { SCHEMA } from './data.js';
import { createBlobDecoder } from './blob.js';

export { parseHistory } from './history-file.js';
export { parseStatus } from './status-file.js';

// Latest value per (pid, field) of the entity state the overworld views use, and per (pid, square) of ocean changes
const LATEST_TYPES = new Set([
    'Wall_Set',
    'Teleporter',
    'Freezer',
    'Rock',
    'Area_Pin',
    'Fence',
    'Gate',
    'Lily',
    'Switch',
    'Ocean_Map',
    'Voice_Log',
    'View_Giver',
    'Monster',
    'Guy',
    'Wardrobe',
    'Promesst_Light',
    'Tree',
    'Gem',
    'Mirror',
    'Rover',
    'Friendly_Dragon',
    'Group',
]);
const LATEST_FIELDS = [
    'base.entity_flags',
    'base.position.x',
    'base.position.y',
    'base.position.z',
    'discovered',
    'enabled_t_target',
    'activated',
    'open',
    'pressed',
    'played',
    'activation_order',
    'base.theta_target',
    'dead_t',
    'skill_flags',
    'powered',
    'properties',
    'exists',
];
// LATEST_FIELDS indices: by name, and per schema field descriptor ('base.' + its name for a base field; -1 when not kept)
const LATEST_INDEX = new Map(LATEST_FIELDS.map((n, i) => [n, i])),
    fieldIndex = new WeakMap(),
    latestIndex = (field, derived) => {
        let v = fieldIndex.get(field);
        if (v === undefined) fieldIndex.set(field, (v = LATEST_INDEX.get((derived ? '' : 'base.') + field.n) ?? -1));
        return v;
    };
const latestCache = new WeakMap(),
    ZERO32 = new Uint8Array(4),
    NF = 32;
// Values are keyed pid * NF + LATEST_FIELDS index. On equal keys the first CHANGE wins, but a CREATION_OR_DESTRUCTION
// action wins over the actions before it (an Activator reset destroys and creates the same pid in one record).
// `created`: per pid with CREATION_OR_DESTRUCTION records, the latest one's { type, destroyed }; a created entity's blob
// holds the whole entity, a position axis missing from it is 0. `skills`: per Guy pid, [record key, skill_flags] of its
// CHANGE actions, in history order.
export function latestOf(history) {
    if (latestCache.has(history)) return latestCache.get(history);
    const vals = new Map(),
        ocean = new Map(),
        made = new Map(),
        skills = new Map(),
        put = (map, entry, key, value, later = false) => {
            const o = map.get(entry);
            if (!o || key > o.key || (later && key === o.key)) map.set(entry, { key, v: value });
        };
    for (const action of history.actions) {
        if (action.type === 3) {
            put(ocean, action.pid + ':' + action.index, action.key, action);
            continue;
        }
        const typeName = history.types[action.etype]?.name,
            made2 = action.type === 2;
        if (made2) put(made, action.pid, action.key, { type: typeName, destroyed: action.destroyed }, true);
        if (!LATEST_TYPES.has(typeName) || (made2 && action.destroyed)) continue;
        let decoded;
        try {
            decoded = decodeBlob(action.blob, typeName, action.type === 1);
        } catch {
            continue;
        }
        // bits 1..3: the position axes the blob holds
        let pos = 0;
        for (const field of decoded.fields) {
            const li = latestIndex(field.f, field.derived);
            if (li >= 0 && field.new.raw) put(vals, action.pid * NF + li, action.key, field.new.raw, made2);
            if (made2 && li >= 1 && li <= 3) pos |= 1 << li;
            if (typeName === 'Guy' && !made2 && field.f.n === 'skill_flags' && field.new.raw) {
                if (!skills.has(action.pid)) skills.set(action.pid, []);
                skills.get(action.pid).push([action.key, rawU32(field.new.raw)]);
            }
        }
        if (made2)
            for (let li = 1; li <= 3; li++)
                if (!(pos & (1 << li))) put(vals, action.pid * NF + li, action.key, ZERO32, true);
    }
    const out = {
        get: (pid, field) => vals.get(pid * NF + LATEST_INDEX.get(field))?.v,
        ocean: [...ocean.values()].map((o) => o.v),
        created: new Map([...made].map(([pid, o]) => [pid, o.v])),
        skills,
    };
    latestCache.set(history, out);
    return out;
}
const rawDV = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
export const rawF32 = (bytes) => rawDV(bytes).getFloat32(0, true),
    rawU32 = (bytes) => rawDV(bytes).getUint32(0, true),
    rawU16 = (bytes) => rawDV(bytes).getUint16(0, true);
// a latest flag byte (1: set) of latestOf() values `latest`, else `fallback`; a latest f32, else `fallback`
export const latestFlag = (latest, pid, field, fallback) => {
        const v = latest?.get(pid, field);
        return v ? v[0] === 1 : !!fallback;
    },
    latestF32 = (latest, pid, field, fallback) => {
        const v = latest?.get(pid, field);
        return v ? rawF32(v) : fallback;
    };
// Guy.skill_flags PROTECTION and TELEPORT
export const PROTECTION_FLAG = 16,
    TELEPORT_FLAG = 8;
// "x,y,z" of the kept hero positions whose record ends with the Guy holding the skill `flag` (by his skill_flags
// changes by key; at the start he holds PROTECTION when the level data gives it)
export function heroesWithSkill(history, guy, flag) {
    const ch = (latestOf(history).skills.get(guy[0]) || []).toSorted((a, b) => a[0] - b[0]),
        out = new Set();
    let sk = guy[1] ? PROTECTION_FLAG : 0,
        n = 0;
    for (const [key, p] of (history.heroAt || []).toSorted((a, b) => a[0] - b[0])) {
        while (n < ch.length && ch[n][0] <= key) sk = ch[n++][1];
        if (sk & flag) out.add(p.join(','));
    }
    return out;
}
export const protectedHeroes = (history, guy) => heroesWithSkill(history, guy, PROTECTION_FLAG);

// an entity diff blob, decoded by the schema
export const decodeBlob = createBlobDecoder(SCHEMA);
