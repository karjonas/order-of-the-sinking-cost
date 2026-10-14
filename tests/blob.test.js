// Entity diff blobs on small synthetic buffers, against the field lists in data/schema.json
import { expect, test } from 'vitest';
import { SCHEMA } from '../src/data.js';
import { decodeBlob } from '../src/save.js';
import { Writer } from './writer.js';

// the first field of a value kind, with its type ('#base' for the base entity data) and index at the current version
function fieldOf(matches) {
    for (const [type, fields] of [
        ['#base', SCHEMA.base.fields],
        ...Object.entries(SCHEMA.types)
            .filter(([, schemaType]) => schemaType.fields)
            .map(([name, schemaType]) => [name, schemaType.fields]),
    ]) {
        const field = fields.find(matches);
        if (field) return { type, f: field };
    }
    throw new Error('no such field');
}
const BASE_VERSION = Math.max(...SCHEMA.base.fields.map((field) => field.v[0]));
const typeVersion = (type) => (type === '#base' ? 1 : SCHEMA.types[type].version);
const blobType = (type) => (type === '#base' ? 'Guy' : type);

// value writers for each kind; each returns what the reader gives back
const plain = (writer, size, seed) => {
    const bytes = Array.from({ length: size }, (_, index) => (seed + index) & 0xff);
    writer.bytes(bytes);
    return { raw: bytes };
};
const text = (writer, content) => {
    writer.str64(content);
    return { str: content };
};
function value(writer, field, seed) {
    if (field.k === 'p') return plain(writer, field.sz, seed);
    if (field.k === 's' || field.k === 'r') return text(writer, `v${seed}`);
    const count = seed % 3;
    writer.s64(count);
    if (field.e.k === 'p') {
        const bytes = Array.from({ length: count * field.e.sz }, (_, index) => (seed + index) & 0xff);
        writer.bytes(bytes);
        return { arr: count, raw: bytes };
    }
    return { arr: count, items: Array.from({ length: count }, (_, index) => text(writer, `e${seed}.${index}`)) };
}
// a blob of the given fields ({ f, derived }) at the current versions, and what decoding it gives
function blobOf(type, entries, hasOld) {
    const writer = new Writer().u16(BASE_VERSION).u16(typeVersion(type));
    const want = [];
    entries.forEach(({ f: field, derived }, entryIndex) => {
        writer.u16((derived ? 0x1000 : 0) + field.i);
        const old = hasOld ? value(writer, field, 10 * entryIndex + 1) : null;
        want.push({ n: field.n, derived, old, new: value(writer, field, 10 * entryIndex + 5) });
        writer.u8(0xfd);
    });
    return { blob: writer.done(), want };
}
// decoded fields in the writers' shape (raw bytes as plain arrays; toEqual ignores the undefined keys)
const norm = (decoded) =>
    decoded && { ...decoded, raw: decoded.raw && [...decoded.raw], items: decoded.items?.map(norm) };
const got = (decoded) =>
    decoded.fields.map((entry) => ({
        n: entry.f.n,
        derived: entry.derived,
        old: norm(entry.old),
        new: norm(entry.new),
    }));

const KINDS = {
    p1: (field) => field.k === 'p' && field.sz === 1,
    p2: (field) => field.k === 'p' && field.sz === 2,
    p4: (field) => field.k === 'p' && field.sz === 4,
    p8: (field) => field.k === 'p' && field.sz === 8,
    p12: (field) => field.k === 'p' && field.sz === 12,
    string: (field) => field.k === 's',
    'resource name': (field) => field.k === 'r',
    'array of plain': (field) => field.k === 'a' && field.e.k === 'p',
    'array of resource names': (field) => field.k === 'a' && field.e.k === 'r',
};

test.each(Object.keys(KINDS))('a %s value, as CHANGE (old and new) and CREATION (new only)', (kind) => {
    const { type, f: field } = fieldOf(KINDS[kind]);
    const derived = type !== '#base';
    for (const hasOld of [true, false]) {
        const { blob, want } = blobOf(blobType(type), [{ f: field, derived }], hasOld);
        expect(got(decodeBlob(blob, blobType(type), hasOld))).toEqual(want);
    }
});

test('an empty array, and base and derived fields in one blob', () => {
    const arrayField = fieldOf(KINDS['array of plain']);
    const base = SCHEMA.base.fields.find((field) => field.n === 'position.x');
    const writer = new Writer().u16(BASE_VERSION).u16(typeVersion(arrayField.type));
    writer.u16(base.i).u32(1).u32(2).u8(0xfd);
    writer
        .u16(0x1000 + arrayField.f.i)
        .s64(0)
        .s64(0)
        .u8(0xfd);
    const decoded = decodeBlob(writer.done(), arrayField.type, true);
    expect(decoded.fields.map((entry) => [entry.derived, entry.f.n, entry.new.arr ?? entry.new.raw.length])).toEqual([
        [false, 'position.x', 4],
        [true, arrayField.f.n, 0],
    ]);
    expect(decoded.fields[1].old).toEqual({ arr: 0, raw: new Uint8Array(0) });
});

test('any of the top 4 header bits marks a derived field; the low 12 bits are the index', () => {
    const field = SCHEMA.types.Guy.fields[0];
    const writer = new Writer().u16(BASE_VERSION).u16(typeVersion('Guy'));
    writer.u16(0x2000).fill(field.sz, 1).u8(0xfd);
    writer.u16(0xf000).fill(field.sz, 2).u8(0xfd);
    const decoded = decodeBlob(writer.done(), 'Guy', false);
    expect(decoded.fields.map((entry) => [entry.derived, entry.f.n])).toEqual([
        [true, field.n],
        [true, field.n],
    ]);
});

test('a bad terminator, an index out of range and a type without a schema throw', () => {
    const positionField = SCHEMA.base.fields.find((field) => field.n === 'position.x');
    expect(() =>
        decodeBlob(new Writer().u16(BASE_VERSION).u16(1).u16(positionField.i).u32(0).u8(0xfe).done(), 'Guy', false),
    ).toThrow(/bad terminator 0xfe after position\.x/);
    const fieldCount = SCHEMA.types.Guy.fields.length;
    expect(() =>
        decodeBlob(
            new Writer()
                .u16(BASE_VERSION)
                .u16(typeVersion('Guy'))
                .u16(0x1000 + fieldCount)
                .done(),
            'Guy',
            false,
        ),
    ).toThrow(new RegExp(`field index ${fieldCount} out of range for Guy`));
    expect(() => decodeBlob(new Writer().u16(BASE_VERSION).u16(1).done(), 'No_Such_Type', false)).toThrow(/no schema/);
});

// Older blobs count only the fields their version has; a struct member's leaves come and go with the member
test('an older Monster blob has no default_transmute_tint_color leaves', () => {
    const fields = SCHEMA.types.Monster.fields,
        tint = fields.find((field) => field.n === 'default_transmute_tint_color.x'),
        spawner = fields.find((field) => field.n === 'transmute_spawner_source_id');
    expect(tint.v[0]).toBe(16);
    const one = (version, index, size) =>
        new Writer()
            .u16(BASE_VERSION)
            .u16(version)
            .u16(0x1000 + index)
            .zeros(size)
            .u8(0xfd)
            .done();
    expect(decodeBlob(one(16, tint.i, tint.sz), 'Monster', false).fields[0].f.n).toBe('default_transmute_tint_color.x');
    expect(() => decodeBlob(one(15, tint.i, tint.sz), 'Monster', false)).toThrow(/out of range for Monster/);
    expect(decodeBlob(one(15, spawner.i, spawner.sz), 'Monster', false).fields[0].f.n).toBe(spawner.n);
    expect(() => decodeBlob(one(14, spawner.i, spawner.sz), 'Monster', false)).toThrow(/out of range/);
});

test('a v13 base skips the scale leaves, so later base fields move down three', () => {
    const fields = SCHEMA.base.fields,
        scale = fields.filter((field) => field.n.startsWith('scale.'));
    expect(scale.map((field) => [field.i, field.v[0]])).toEqual([
        [3, 14],
        [4, 14],
        [5, 14],
    ]);
    const after = fields[6];
    const blob = (baseVersion) =>
        new Writer().u16(baseVersion).u16(typeVersion('Guy')).u16(3).zeros(after.sz).u8(0xfd).done();
    expect(decodeBlob(blob(13), 'Guy', false).fields[0].f.n).toBe(after.n);
    expect(decodeBlob(blob(14), 'Guy', false).fields[0].f.n).toBe('scale.x');
});
