// Entity diff blobs: a field is in a blob of version v from its first version on; leaves flattened out of a struct
// member carry that top-level member's versions
import { Reader } from './reader.js';

export function atVersion(fields, v) {
    return fields.filter((f) => f.v[0] === -1 || f.v[0] <= v);
}
function readVal(r, d) {
    if (d.k === 'p') return { raw: r.bytes(d.sz) };
    if (d.k === 's' || d.k === 'r') return { str: r.str64() };
    if (d.k === 'a') {
        const n = r.n64();
        if (d.e.k === 'p') return { arr: n, raw: r.bytes(n * d.e.sz) };
        const items = [];
        for (let i = 0; i < n; i++) items.push(readVal(r, d.e));
        return { arr: n, items };
    }
    throw new Error(`cannot decode field type ${d.t}`);
}
// A decoder for the blobs of the entity types in `schema` (data/schema.json)
export function createBlobDecoder(schema) {
    const fieldCache = new Map();
    function fieldsFor(type, ver, derived) {
        const key = (derived ? type : '#base') + '@' + ver;
        if (!fieldCache.has(key))
            fieldCache.set(key, atVersion(derived ? schema.types[type].fields : schema.base.fields, ver));
        return fieldCache.get(key);
    }
    return function decodeBlob(blob, typeName, hasOld) {
        const r = new Reader(blob);
        const out = { baseVer: r.u16(), typeVer: r.u16(), fields: [] };
        if (!schema.types[typeName] || schema.types[typeName].missing)
            throw new Error(`no schema for entity type ${typeName}`);
        let base = null,
            own = null;
        while (r.left) {
            const hdr = r.u16(),
                idx = hdr & 0xfff,
                derived = hdr > 0xfff; // any bit of the top 4 marks the derived type's field (the game writes 0x1000)
            const list = derived
                ? (own ||= fieldsFor(typeName, out.typeVer, true))
                : (base ||= fieldsFor(typeName, out.baseVer, false));
            const f = list[idx];
            if (!f) throw new Error(`field index ${idx} out of range for ${derived ? typeName : 'base'}`);
            const old = hasOld ? readVal(r, f) : null;
            const nv = readVal(r, f);
            const t = r.u8();
            if (t !== 0xfd) throw new Error(`bad terminator 0x${t.toString(16)} after ${f.n}`);
            out.fields.push({ f, derived, old, new: nv });
        }
        return out;
    };
}
