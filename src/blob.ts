// Entity diff blobs: a field is in a blob of version v from its first version on; leaves flattened out of a struct
// member carry that top-level member's versions
import { Reader } from './reader.ts';
import type { Schema, SchemaField } from './types.ts';

/** A decoded value: raw bytes of a plain field, a string, or an array with its raw bytes or its items. */
export interface FieldValue {
    raw?: Uint8Array;
    str?: string;
    arr?: number;
    items?: FieldValue[];
}

/**
 * One field of a blob: its schema descriptor, whether it belongs to the derived type, the old value (when the blob
 * holds one) and the new.
 */
export interface DecodedField {
    f: SchemaField;
    derived: boolean;
    old: FieldValue | null;
    new: FieldValue;
}

/** A decoded blob: the versions of the base entity and of the type, and its fields in blob order. */
export interface DecodedBlob {
    baseVersion: number;
    typeVersion: number;
    fields: DecodedField[];
}

/** The fields a blob of `version` holds. */
export function atVersion(fields: SchemaField[], version: number): SchemaField[] {
    return fields.filter((field) => field.v[0] === -1 || field.v[0] <= version);
}

function readValue(reader: Reader, descriptor: SchemaField): FieldValue {
    if (descriptor.k === 'p') return { raw: reader.bytes(descriptor.sz!) };
    if (descriptor.k === 's' || descriptor.k === 'r') return { str: reader.str64() };
    if (descriptor.k === 'a') {
        const count = reader.n64();
        const element = descriptor.e!;
        if (element.k === 'p') return { arr: count, raw: reader.bytes(count * element.sz!) };

        const items: FieldValue[] = [];
        for (let i = 0; i < count; i++) items.push(readValue(reader, element));
        return { arr: count, items };
    }

    throw new Error(`cannot decode field type ${descriptor.t}`);
}

/** A decoder for the blobs of the entity types in `schema` (data/schema.json). */
export function createBlobDecoder(
    schema: Schema,
): (blob: Uint8Array, typeName: string, hasOld: boolean) => DecodedBlob {
    const fieldCache = new Map<string, SchemaField[]>();

    function fieldsFor(type: string, version: number, derived: boolean): SchemaField[] {
        const key = (derived ? type : '#base') + '@' + version;
        let fields = fieldCache.get(key);
        if (!fields) {
            fields = atVersion(derived ? schema.types[type].fields! : schema.base.fields, version);
            fieldCache.set(key, fields);
        }
        return fields;
    }

    return function decodeBlob(blob, typeName, hasOld) {
        const reader = new Reader(blob);
        const decoded: DecodedBlob = { baseVersion: reader.u16(), typeVersion: reader.u16(), fields: [] };
        if (!schema.types[typeName] || schema.types[typeName].missing) {
            throw new Error(`no schema for entity type ${typeName}`);
        }

        let baseFields: SchemaField[] | null = null;
        let ownFields: SchemaField[] | null = null;
        while (reader.left) {
            const header = reader.u16();
            const index = header & 0xfff;
            // any bit of the top 4 marks the derived type's field (the game writes 0x1000)
            const derived = header > 0xfff;
            let list: SchemaField[];
            if (derived) {
                ownFields ??= fieldsFor(typeName, decoded.typeVersion, true);
                list = ownFields;
            } else {
                baseFields ??= fieldsFor(typeName, decoded.baseVersion, false);
                list = baseFields;
            }
            const field = list[index];
            if (!field) throw new Error(`field index ${index} out of range for ${derived ? typeName : 'base'}`);

            const old = hasOld ? readValue(reader, field) : null;
            const value = readValue(reader, field);
            const terminator = reader.u8();
            if (terminator !== 0xfd) {
                throw new Error(`bad terminator 0x${terminator.toString(16)} after ${field.n}`);
            }
            decoded.fields.push({ f: field, derived, old, new: value });
        }
        return decoded;
    };
}
