// The Signs row of the sidebar's Find on the map: the signs that open Freezers, found when read, over the ones not
// under fog, and the ones ready to read (their rule holds); and, when SOKO_SAVES names a folder of snapshots, its default save, read-only
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { savesDir } from '../scripts/saves.js';
import { PROG, worldReady } from '../src/data.ts';
import { parseHistory, parseStatus } from '../src/save.ts';
import { setProgressCache } from '../src/model/progress.ts';
import { signRuleMet } from '../src/model/unlocking.ts';
import { totalsOf } from '../src/model/totals.ts';
import { setSpoilersHidden, state } from '../src/shared.ts';
import { showDemo } from '../src/files.ts';
import { progressModel } from '../src/model/progress-model.ts';

// the page, without its DOM
vi.mock('../src/view.ts', () => ({ show() {} }));

const LIVE = 'default';
const hasSave = (camp) =>
    Boolean(process.env.SOKO_SAVES) &&
    existsSync(join(savesDir(), camp, 'Status.sokoban_status')) &&
    existsSync(join(savesDir(), camp, 'overworld.history'));

beforeAll(async () => {
    await worldReady;
    setProgressCache(new WeakMap());
    await showDemo();
    if (!hasSave(LIVE)) return;
    const read = (name) => new Uint8Array(readFileSync(join(savesDir(), LIVE, name)));
    state.files.set(`${LIVE}/Status.sokoban_status`, {
        path: `${LIVE}/Status.sokoban_status`,
        parsed: parseStatus(read('Status.sokoban_status')),
        error: null,
    });
    state.files.set(`${LIVE}/overworld.history`, {
        path: `${LIVE}/overworld.history`,
        parsed: parseHistory(read('overworld.history')),
        error: null,
    });
});

// the totals of a save that has only a rank: no tower active, no gold room found, no Freezer open, nothing found
function totalsAtRank(rank, shownAt, known, readPids = []) {
    const progress = {
        gateOpen: PROG.freezers.map(() => false),
        tst: PROG.teleporters.map(() => ({ disc: false })),
        lt: null,
        signOk: (rule) => signRuleMet(rule, { rank }, [], 0),
        signRead: (pid) => readPids.includes(pid),
    };
    return totalsOf({ status: { treasureFlags: 0 }, progress, hide: known !== null, shownAt, known });
}

const openingSigns = () => PROG.signs.filter((sign) => !sign.status);

describe('the Signs row', () => {
    test('counts the Signs that open Freezers, none of the tower status Signs', () => {
        const everywhere = () => true;
        const totals = totalsAtRank(0, everywhere, null);
        expect(openingSigns().length).toBeLessThan(PROG.signs.length);
        expect(totals.stats.signs).toEqual([0, 17]);
        expect(totals.stats.by.signs).toBe('Ground 0 / 8 · Sky 0 / 8 · Underworld 0 / 1');
        expect(totals.finds.signs.open.length).toBe(17);
        expect(totals.finds.signs.fogged).toBe(0);
    });

    test('at rank 1 the rank 1 Signs are ready to read, not found', () => {
        const rankOneSigns = openingSigns().filter((sign) => sign.rank === 1);
        const totals = totalsAtRank(1, () => true, null);
        expect(rankOneSigns.length).toBe(5);
        expect(totals.stats.signs).toEqual([0, 17]);
        expect(totals.stats.signsReady).toBe(5);
        expect(totals.stats.by.signs).toBe('Ground 0 / 8 · Sky 0 / 8 · Underworld 0 / 1');

        // the find action frames the 5 ready Signs first, then the 12 others
        const finds = totals.finds.signs;
        expect(finds.open.length).toBe(17);
        expect(finds.ready).toBe(5);
        expect(finds.open.slice(0, 5)).toEqual(rankOneSigns.map((sign) => sign.p));
    });

    test('a read Sign is found whatever its rule says', () => {
        const rankOneSigns = openingSigns().filter((sign) => sign.rank === 1);
        const readPids = rankOneSigns.map((sign) => sign.pid);
        const totals = totalsAtRank(1, () => true, null, readPids);
        expect(totals.stats.signs).toEqual([5, 17]);
        expect(totals.stats.signsReady).toBe(0);
        expect(totals.finds.signs.open.length).toBe(12);
        expect(totals.finds.signs.ready).toBe(0);
    });

    test('a read Sign with its rule not holding counts as found', () => {
        const rankFive = openingSigns().find((sign) => sign.rank === 5);
        const totals = totalsAtRank(0, () => true, null, [rankFive.pid]);
        expect(totals.stats.signs).toEqual([1, 17]);
        expect(totals.stats.signsReady).toBe(0);
    });

    test('a Sign under fog is left out of the count and the split, and the find action counts it as fogged', () => {
        const notSky = (layer) => layer !== 'sky';
        const totals = totalsAtRank(1, notSky, ['ground', 'underworld']);
        expect(totals.stats.signs).toEqual([0, 9]);
        expect(totals.stats.signsReady).toBe(5);
        expect(totals.stats.by.signs).toBe('Ground 0 / 8 · Underworld 0 / 1');
        expect(totals.finds.signs.open.length).toBe(9);
        expect(totals.finds.signs.fogged).toBe(8);
    });

    test('nothing is listed while every Sign is under fog', () => {
        const nowhere = () => false;
        const totals = totalsAtRank(1, nowhere, []);
        expect(totals.stats.signs).toEqual([0, 0]);
        expect(totals.stats.by.signs).toBe('');
        expect(totals.finds.signs.open).toEqual([]);
        expect(totals.finds.signs.fogged).toBe(17);
    });

    test('the demo with spoilers hidden has no fog data, so every Sign is under fog', () => {
        setSpoilersHidden(true);
        const model = progressModel('No save loaded');
        expect(model.stats.signs).toEqual([0, 0]);
    });

    test.skipIf(!hasSave(LIVE))('the snapshot save counts the Signs not under fog by their reading', () => {
        setSpoilersHidden(true);
        const model = progressModel(LIVE);
        const shownSigns = [];
        PROG.signs.forEach((sign, i) => {
            if (!sign.status && model.signSet.has(i)) shownSigns.push(sign);
        });

        const read = shownSigns.filter((sign) => model.progress.signRead(sign.pid));
        const ready = shownSigns.filter((sign) => !model.progress.signRead(sign.pid) && model.progress.signOk(sign));
        expect(model.stats.signs).toEqual([read.length, shownSigns.length]);
        expect(model.stats.signsReady).toBe(ready.length);

        // the rest of the Signs, framed on the map, are the ones shown and not read, the ready ones first
        const unread = shownSigns.filter((sign) => !model.progress.signRead(sign.pid));
        const unreadNotReady = unread.filter((sign) => !ready.includes(sign));
        expect(model.finds.signs.open).toEqual([...ready, ...unreadNotReady].map((sign) => sign.p));
        expect(model.finds.signs.ready).toBe(ready.length);
    });
});
