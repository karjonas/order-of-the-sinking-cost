// The Status.sokoban_status reader at each file version it loads
import { expect, test } from 'vitest';
import { parseStatus } from '../src/save.ts';
import { Writer } from './writer.js';

// A file of the given version with a distinct value in every field that version has; legacy fields are filled with 0xee
// bytes (and legacy strings say so), so a reader that takes one for a kept field reads the wrong value
function statusFile(version) {
    const writer = new Writer().u32(version);
    if (version >= 30) writer.u32(7);
    if (version >= 12) writer.s64(101).s64(102);
    if (version >= 19) {
        writer.u8(3).s64(103).s64(104);
        if (version >= 22) writer.s64(105);
        if (version >= 27) writer.u32(106);
    }
    writer.u32(200).u32(201);
    if (version <= 25) writer.fill(4, 0xee);
    for (const counter of version >= 8 ? [2, 3, 4, 5, 6, 7, 8, 9] : [2, 3, 4, 5, 8, 9]) writer.u32(200 + counter);
    if (version >= 13) writer.s64(107);
    if (version >= 9) writer.u32(108);
    if (version >= 11) writer.s32(-109);
    if (version >= 19) writer.s32(110);
    if (version >= 20) writer.s32(111);
    if (version >= 16) writer.u8(2);
    if (version >= 24) writer.u8(0);
    if (version >= 23 && version <= 31) writer.fill(33, 0xee);
    if (version >= 17 && version <= 20) writer.fill(version === 17 ? 8 : 9, 0xee);
    if (version <= 24) writer.str16('legacy');
    writer.str16('current');
    if (version >= 33) writer.str16('menu');
    writer.u32(2).str16('a').u8(1).str16('b').u8(4);
    if (version >= 10) {
        writer.u32(1).str16('key').s64(-5).str16('text');
        if (version >= 14 && version <= 27) writer.u32(2).str16('legacy').str16('legacy');
    }
    if (version >= 6 && version <= 14) writer.u32(1).str16('legacy');
    if (version >= 7) writer.u32(2).u32(31).u32(32);
    if (version >= 29) writer.u32(1).u32(33);
    return writer.done();
}

// what statusFile(version) holds, with the reader's defaults for the fields that version does not have
function expected(version) {
    const counters = [200, 201, 202, 203, 204, 205, version >= 8 ? 206 : 0, version >= 8 ? 207 : 0, 208, 209];
    return {
        version,
        reserved: version >= 30 ? 7 : 0,
        savedLo: version >= 12 ? 101n : 0n,
        savedHi: version >= 12 ? 102n : 0n,
        rank: version >= 19 ? 3 : 0,
        playLo: version >= 19 ? 103n : 0n,
        playHi: version >= 19 ? 104n : 0n,
        achievements: version >= 22 ? 105n : 0n,
        treasureFlags: version >= 27 ? 106 : 0,
        counters,
        artifacts: version >= 13 ? 107n : 0n,
        currentAreaPin: version >= 9 ? 108 : 0,
        levelsSolved: version >= 11 ? -109 : 0,
        towerLevelsSolved: version >= 19 ? 110 : 0,
        towersActivated: version >= 20 ? 111 : 0,
        overheadMap: version >= 16 ? 2 : 0,
        overworldUnlocked: version >= 24 ? 0 : 1,
        currentLevel: 'current',
        menuLevel: version >= 33 ? 'menu' : '',
        levels: [
            { name: 'a', flags: 1 },
            { name: 'b', flags: 4 },
        ],
        table2: version >= 10 ? [{ key: 'key', value: -5n, text: 'text' }] : [],
        openedFreezers: version >= 7 ? [31, 32] : [],
        openedFreezersOther: version >= 29 ? [33] : [],
    };
}

// every version the game loads; nearly each one adds or drops a field
const VERSIONS = Array.from({ length: 29 }, (_, index) => 33 - index);

test.each(VERSIONS)('version %i', (version) => {
    const bytes = statusFile(version);
    expect(parseStatus(bytes)).toEqual(expected(version));
    // every byte is needed: a reader that skips too much runs out
    expect(() => parseStatus(bytes.subarray(0, bytes.length - 1))).toThrow(/past end/);
});

test('the v33 current level string starts at byte 119, and v31 has the 33-byte legacy block before one string', () => {
    const bytes33 = statusFile(33),
        bytes31 = statusFile(31);
    expect(new TextDecoder().decode(bytes33.subarray(121, 128))).toBe('current');
    expect(bytes31[119]).toBe(0xee);
    expect(new TextDecoder().decode(bytes31.subarray(154, 161))).toBe('current');
    expect(parseStatus(bytes31).menuLevel).toBe('');
});

test('versions the game does not load are rejected', () => {
    expect(() => parseStatus(statusFile(4))).toThrow(/version 4 is not supported \(expected 5\.\.33\)/);
    expect(() => parseStatus(new Writer().u32(34).zeros(200).done())).toThrow(/version 34 is not supported/);
});
