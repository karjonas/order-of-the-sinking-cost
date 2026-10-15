// data/walk.json against the walk on the current level data and code: a stale file (other inputs, or walk rules that
// changed since `npm run data:walk`) fails here
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { staticRoles } from '../src/model/static-roles.ts';
import { floorHeights } from '../src/walk/reachability.ts';
import { FLOOR_HEIGHTS, STATIC_ROLES, walkReady } from '../src/walk-data.ts';

const DATA = join(import.meta.dirname, '..', 'data');
const stored = JSON.parse(readFileSync(join(DATA, 'walk.json'), 'utf8'));
const sha256 = (name) =>
    createHash('sha256')
        .update(readFileSync(join(DATA, name)))
        .digest('hex');

beforeAll(async () => {
    await walkReady;
});

test('walk.json was built from the current data files', () => {
    const names = Object.keys(stored.inputs);
    expect(names).toContain('progress.json');
    for (const name of names) expect(stored.inputs[name], name).toBe(sha256(name));
});

test('the stored static roles are the ones the walk works out', () => {
    const live = staticRoles();
    expect([...STATIC_ROLES.need.l]).toEqual([...live.need.l]);
    expect([...STATIC_ROLES.need.g]).toEqual([...live.need.g]);
    expect(STATIC_ROLES.bg).toEqual(live.bg);
});

test('the stored floor heights are the ones the walk works out', () => {
    const live = floorHeights();
    expect(Object.keys(FLOOR_HEIGHTS)).toEqual(Object.keys(live));
    for (const [key, heights] of Object.entries(live)) {
        const bytes = new Uint8Array(heights.buffer, heights.byteOffset, heights.byteLength);
        const storedHeights = FLOOR_HEIGHTS[key];
        const storedBytes = new Uint8Array(storedHeights.buffer, storedHeights.byteOffset, storedHeights.byteLength);
        expect(Buffer.from(storedBytes).equals(Buffer.from(bytes)), key).toBe(true);
    }
});
