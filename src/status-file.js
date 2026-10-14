// Status.sokoban_status
import { Reader } from './reader.js';

// Fields come and go with the file version (5..33, as the game loads them); one missing from an older file keeps its
// default
export function parseStatus(buf) {
    const r = new Reader(buf);
    const v = r.u32();
    if (v < 5 || v > 33) throw new Error(`campaign status version ${v} is not supported (expected 5..33)`);
    const o = {
        version: v,
        reserved: 0,
        savedLo: 0n,
        savedHi: 0n,
        rank: 0,
        playLo: 0n,
        playHi: 0n,
        achievements: 0n,
        treasureFlags: 0,
        counters: Array(10).fill(0),
        artifacts: 0n,
        currentAreaPin: 0,
        levelsSolved: 0,
        towerLevelsSolved: 0,
        towersActivated: 0,
        overheadMap: 0,
        overworldUnlocked: 1,
        currentLevel: '',
        menuLevel: '',
        levels: [],
        table2: [],
        openedFreezers: [],
        openedFreezersOther: [],
    };
    if (v >= 30) o.reserved = r.u32();
    if (v >= 12) {
        o.savedLo = r.s64();
        o.savedHi = r.s64();
    }
    if (v >= 19) {
        o.rank = r.u8();
        o.playLo = r.s64();
        o.playHi = r.s64();
        if (v >= 22) o.achievements = r.s64();
        if (v >= 27) o.treasureFlags = r.u32();
    }
    const c = o.counters;
    c[0] = r.u32();
    c[1] = r.u32();
    if (v <= 25) r.u32(); // a counter dropped in v26
    for (const i of v >= 8 ? [2, 3, 4, 5, 6, 7, 8, 9] : [2, 3, 4, 5, 8, 9]) c[i] = r.u32();
    if (v >= 13) o.artifacts = r.s64();
    if (v >= 9) o.currentAreaPin = r.u32();
    if (v >= 11) o.levelsSolved = r.s32();
    if (v >= 19) o.towerLevelsSolved = r.s32();
    if (v >= 20) o.towersActivated = r.s32();
    if (v >= 16) o.overheadMap = r.u8();
    if (v >= 24) o.overworldUnlocked = r.u8();
    if (v >= 23 && v <= 31) r.skip(33); // legacy u8 + 32 bytes
    if (v >= 17 && v <= 20) r.skip(v === 17 ? 8 : 9); // legacy u32, u32 (+ u8 after v17)
    if (v <= 24) r.str16(); // legacy string before the current level
    o.currentLevel = r.str16();
    if (v >= 33) o.menuLevel = r.str16();
    for (let n = r.u32(); n > 0; n--) o.levels.push({ name: r.str16(), flags: r.u8() });
    if (v >= 10) {
        for (let n = r.u32(); n > 0; n--) o.table2.push({ key: r.str16(), value: r.s64(), text: r.str16() });
        if (v >= 14 && v <= 27) for (let n = r.u32(); n > 0; n--) r.str16(); // legacy string list
    }
    if (v >= 6 && v <= 14) for (let n = r.u32(); n > 0; n--) r.str16(); // legacy string list
    if (v >= 7) for (let n = r.u32(); n > 0; n--) o.openedFreezers.push(r.u32());
    if (v >= 29) for (let n = r.u32(); n > 0; n--) o.openedFreezersOther.push(r.u32());
    return o;
}
