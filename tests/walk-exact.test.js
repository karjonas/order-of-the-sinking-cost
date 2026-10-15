// The walk's exactness check: the fingerprint of everything the walk computes (scripts/lib/walk-fingerprint.js) on a
// fresh campaign, on two small changes of it and on staticRoles(), against the hashes checked in at
// tests/walk-exact.expected.json. A change that should alter no answer keeps every hash; a failure names the fields
// that moved. The level data alone (NO_HISTORY, every pad on) takes seconds under Vitest and is left to the script:
// `node scripts/walk-fingerprint.js --no-history <out>`.
//
// The hashes follow the level data (data/progress.json) and the walk's rules. After an intended change of either, or
// after `npm run data` brings new game data, regenerate the file and review the diff:
//   UPDATE_WALK_EXPECTED=1 npx vp test run tests/walk-exact.test.js
// To see what changed inside a field, write the fingerprint before and after with scripts/walk-fingerprint.js and run
// its --diff.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
    fingerprintOf,
    freshCampaign,
    saveOutputs,
    staticRolesOutputs,
    walkLoaded,
} from '../scripts/lib/walk-fingerprint.js';
import { PROG } from '../src/data.ts';
import { computeProgress } from '../src/model/progress.ts';
import { latestOf, overrideLatest } from '../src/save.ts';
import { teleporterStatesOf } from '../src/walk/teleporters.ts';
import { walker } from '../src/walk/walker.ts';

const EXPECTED_FILE = join(import.meta.dirname, 'walk-exact.expected.json');
const UPDATING = process.env.UPDATE_WALK_EXPECTED === '1';

// a Group of the fast-travel map rooms; making it exist moves the pad linkage and the pockets of the fresh campaign
const FLIPPED_GROUP_PID = 62929123;

const recorded = {};
let expected = {};
let fresh = null;
let freshOutputs = null;
let freshFingerprint = null;

function float32Bytes(value) {
    return new Uint8Array(new Float32Array([value]).buffer);
}

// the latest values of `history` with some replaced: `values` maps `${pid}:${field}` to raw bytes
function withValues(latest, values) {
    return { ...latest, get: (pid, field) => values.get(`${pid}:${field}`) ?? latest.get(pid, field) };
}

function changedHistory(history, values) {
    const changed = { ...history };
    overrideLatest(changed, withValues(latestOf(history), values));
    return changed;
}

// The first Rock of the level data with a reached cell above it, pushed one cell east in the save's latest values
function rockPushedEast(history, reached) {
    const probe = walker(latestOf(history), teleporterStatesOf(null), []);
    const [cornerX, cornerY] = PROG.world.grid.corner;

    for (const [pid, column, row, z] of PROG.world.rocks) {
        const above = probe.cellOf(column + cornerX, row + cornerY, z + 1);
        if (!reached.has(above) && !reached.has(probe.land(above))) continue;

        const pushedX = float32Bytes(column + cornerX + 1);
        return changedHistory(history, new Map([[`${pid}:base.position.x`, pushedX]]));
    }

    throw new Error('no Rock has a reached cell above it');
}

function flippedGroup(history) {
    const group = PROG.world.egroups.find(([pid]) => pid === FLIPPED_GROUP_PID);
    const [pid, existsByDefault] = group;
    const flipped = Uint8Array.of(existsByDefault ? 0 : 1);
    return changedHistory(history, new Map([[`${pid}:exists`, flipped]]));
}

function expectHashes(name, fingerprint) {
    recorded[name] = fingerprint.hashes;
    if (!UPDATING) expect(fingerprint.hashes).toEqual(expected[name]);
}

function changedFields(before, after) {
    return Object.keys(before.hashes).filter((name) => before.hashes[name] !== after.hashes[name]);
}

beforeAll(async () => {
    await walkLoaded();
    if (!UPDATING) expected = JSON.parse(readFileSync(EXPECTED_FILE, 'utf8'));
    fresh = freshCampaign();
    freshOutputs = saveOutputs(fresh.status, fresh.history);
    freshFingerprint = fingerprintOf(freshOutputs);
});

afterAll(() => {
    if (UPDATING) writeFileSync(EXPECTED_FILE, JSON.stringify(recorded, null, 4) + '\n');
});

describe('the walk fingerprint', () => {
    test('the fresh campaign gives the checked-in hashes, and the same ones twice', () => {
        expectHashes('fresh', freshFingerprint);

        const again = fingerprintOf(saveOutputs(fresh.status, fresh.history));
        expect(again.hashes).toEqual(freshFingerprint.hashes);
    });

    test('one Rock pushed one cell moves the reached cells', () => {
        const moved = rockPushedEast(fresh.history, freshOutputs['reach.reached']);
        const fingerprint = fingerprintOf(saveOutputs(fresh.status, moved));
        const changed = changedFields(freshFingerprint, fingerprint);

        expectHashes('rockPushed', fingerprint);
        expect(changed).toContain('reach.reached');
        expect(changed).toContain('reach.cols');
    });

    test('one Group made to exist moves the pad linkage and the pockets', () => {
        const flipped = flippedGroup(fresh.history);
        const fingerprint = fingerprintOf(saveOutputs(fresh.status, flipped));
        const changed = changedFields(freshFingerprint, fingerprint);

        expectHashes('groupFlipped', fingerprint);
        expect(changed).toContain('walker.shown');
        expect(changed).toContain('reach.pocket');
    });

    test('the reached cells are the main flood from the seeds, worked out here', () => {
        const progress = computeProgress(fresh.status, fresh.history);
        const walk = walker(
            progress.lt,
            progress.tst,
            progress.gateOpen.map((open) => !open),
        );
        const seeds = [walk.heroSeed(fresh.history.hero)];
        PROG.teleporters.forEach((_, padIndex) => {
            if (progress.tst[padIndex].disc) seeds.push(walk.padCell(padIndex));
        });

        const flooded = [...walk.flood(seeds, null, new Set())].toSorted((left, right) => left - right);
        const reached = [...progress.reach.reached].toSorted((left, right) => left - right);
        expect(reached).toEqual(flooded);
    });

    test('staticRoles() gives the checked-in hashes', () => {
        expectHashes('staticRoles', fingerprintOf(staticRolesOutputs()));
    });
});
