// Status.sokoban_status
import { Reader } from './reader.ts';

/** A parsed Status.sokoban_status. */
export interface Status {
    version: number;
    reserved: number;
    savedLo: bigint;
    savedHi: bigint;
    rank: number;
    playLo: bigint;
    playHi: bigint;
    achievements: bigint;
    treasureFlags: number;
    counters: number[];
    artifacts: bigint;
    currentAreaPin: number;
    levelsSolved: number;
    towerLevelsSolved: number;
    towersActivated: number;
    overheadMap: number;
    overworldUnlocked: number;
    currentLevel: string;
    menuLevel: string;
    levels: Array<{ name: string; flags: number }>;
    table2: Array<{ key: string; value: bigint; text: string }>;
    openedFreezers: number[];
    openedFreezersOther: number[];
}

/** The status of the empty save the page shows before a file is loaded: the fields the progress view reads. */
export type DemoStatus = Pick<
    Status,
    'version' | 'rank' | 'achievements' | 'treasureFlags' | 'artifacts' | 'levels' | 'openedFreezers'
> &
    Partial<Status>;

/**
 * Fields come and go with the file version (5..33, as the game loads them); one missing from an older file keeps its
 * default.
 */
export function parseStatus(buffer: Uint8Array | ArrayBuffer): Status {
    const reader = new Reader(buffer);
    const version = reader.u32();
    if (version < 5 || version > 33) {
        throw new Error(`campaign status version ${version} is not supported (expected 5..33)`);
    }

    const status: Status = {
        version,
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

    if (version >= 30) status.reserved = reader.u32();
    if (version >= 12) {
        status.savedLo = reader.s64();
        status.savedHi = reader.s64();
    }

    if (version >= 19) {
        status.rank = reader.u8();
        status.playLo = reader.s64();
        status.playHi = reader.s64();
        if (version >= 22) status.achievements = reader.s64();
        if (version >= 27) status.treasureFlags = reader.u32();
    }

    const counters = status.counters;
    counters[0] = reader.u32();
    counters[1] = reader.u32();
    if (version <= 25) reader.u32(); // a counter dropped in v26

    let laterCounters = [2, 3, 4, 5, 8, 9];
    if (version >= 8) laterCounters = [2, 3, 4, 5, 6, 7, 8, 9];
    for (const i of laterCounters) counters[i] = reader.u32();

    if (version >= 13) status.artifacts = reader.s64();
    if (version >= 9) status.currentAreaPin = reader.u32();
    if (version >= 11) status.levelsSolved = reader.s32();
    if (version >= 19) status.towerLevelsSolved = reader.s32();
    if (version >= 20) status.towersActivated = reader.s32();
    if (version >= 16) status.overheadMap = reader.u8();
    if (version >= 24) status.overworldUnlocked = reader.u8();
    if (version >= 23 && version <= 31) reader.skip(33); // legacy u8 + 32 bytes
    if (version >= 17 && version <= 20) reader.skip(version === 17 ? 8 : 9); // legacy u32, u32 (+ u8 after v17)
    if (version <= 24) reader.str16(); // legacy string before the current level
    status.currentLevel = reader.str16();
    if (version >= 33) status.menuLevel = reader.str16();

    for (let remaining = reader.u32(); remaining > 0; remaining--) {
        status.levels.push({ name: reader.str16(), flags: reader.u8() });
    }

    if (version >= 10) {
        for (let remaining = reader.u32(); remaining > 0; remaining--) {
            status.table2.push({ key: reader.str16(), value: reader.s64(), text: reader.str16() });
        }
        if (version >= 14 && version <= 27) {
            for (let remaining = reader.u32(); remaining > 0; remaining--) reader.str16(); // legacy string list
        }
    }

    if (version >= 6 && version <= 14) {
        for (let remaining = reader.u32(); remaining > 0; remaining--) reader.str16(); // legacy string list
    }

    if (version >= 7) {
        for (let remaining = reader.u32(); remaining > 0; remaining--) status.openedFreezers.push(reader.u32());
    }

    if (version >= 29) {
        for (let remaining = reader.u32(); remaining > 0; remaining--) status.openedFreezersOther.push(reader.u32());
    }

    return status;
}
