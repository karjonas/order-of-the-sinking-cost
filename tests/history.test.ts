// The overworld.history reader on small synthetic files
import { expect, test } from 'vitest';
import type { EntityAction, History, OceanChange, UndoAction } from '../src/history-file.ts';
import { latestOf, parseHistory, rawF32 } from '../src/save.ts';
import type { Position } from '../src/types.ts';
import { Writer } from './writer.ts';

type WriteAction = (writer: Writer) => void;

interface RecordOptions {
    txs?: Array<[version: number, charmCounts: number[]]>;
    lily?: [count: number, groups: Array<[entries12: number, entries16: number]>];
}

type RecordEntry = [first: number, span: number, hero: Position, actions: WriteAction[], options?: RecordOptions];

const isOceanChange = (action: UndoAction): action is OceanChange => action.type === 3;
const isEntityAction = (action: UndoAction): action is EntityAction => action.type !== 3;
const oceanChanges = (history: History): OceanChange[] => history.actions.filter(isOceanChange);
const entityActions = (history: History, type: 1 | 2): EntityAction[] =>
    history.actions.filter(isEntityAction).filter((action) => action.type === type);

// one undo record: header, move transactions (default: one v3 transaction with one single move), lily groups (default:
// one), then the actions. txs: [Move_Transaction version, [deprecated charm Move_Info count per single move]];
// lily: the count byte, then [12-byte entries, 16-byte entries] per group written
function record(
    writer: Writer,
    first: number,
    span: number,
    hero: Position,
    actions: WriteAction[],
    { txs = [[3, [0]]], lily = [1, [[0, 0]]] }: RecordOptions = {},
) {
    writer.s64(first).u32(span).zeros(20).s32(hero[0]).s32(hero[1]).s32(hero[2]);
    writer.u32(txs.length);
    for (const [version, moves] of txs) {
        writer
            .u16(version)
            .zeros(version >= 3 ? 33 : 32)
            .s64(moves.length);
        for (const charms of moves)
            writer
                .u16(1)
                .fill(145, 0xcc)
                .s64(charms)
                .fill(80 * charms, 0xdd);
    }
    writer.u8(lily[0]);
    for (const [entries12, entries16] of lily[1])
        writer
            .zeros(5)
            .u32(entries12)
            .fill(12 * entries12, 0xee)
            .u32(entries16)
            .fill(16 * entries16, 0xee);
    writer.u32(actions.length);
    for (const action of actions) action(writer);
}
const ocean =
    (pid: number, index: number, old: number, newValue: number): WriteAction =>
    (writer) =>
        writer.u8(3).u32(pid).u32(index).u8(old).u8(newValue);
const scrape = (): WriteAction => (writer) => writer.u8(4).zeros(9);
const change =
    (pid: number, blob: number[]): WriteAction =>
    (writer) =>
        writer.u8(1).u32(pid).s64(0).s64(blob.length).bytes(blob);

// a file with one mip level of `records` (each [first, span, hero, actions]), the level-start record (default: empty)
// and the trailer; ends: the byte after each of those records
function historyFile(records: RecordEntry[], types = ['Guy'], start: RecordEntry = [0, 0, [0, 0, 0], []]) {
    const writer = new Writer();
    writer.u32(73).u32(1).s64(25).s64(types.length);
    for (const type of types) writer.str64(type).s64(1);
    writer.zeros(24).u8(1);
    writer.u16(1).u32(400).s32(0).s32(-1).s64(records.length);
    const ends: number[] = [];
    for (const entry of records) {
        record(writer, ...entry);
        ends.push(writer.length);
    }
    record(writer, ...start);
    writer.zeros(16);
    return { buf: writer.done(), ends };
}

const FIRST: RecordEntry = [10, 1, [5, 6, 0], [ocean(7, 300, 1, 0), ocean(7, 2, 0, 5), scrape(), change(9, [1, 2, 3])]];
const SECOND: RecordEntry = [11, 1, [8, 9, 0], [change(9, [4, 5])]];

test('ocean changes are 10 bytes and the records after them stay in step', () => {
    const history = parseHistory(historyFile([FIRST, SECOND]).buf);
    expect(history.error).toBeNull();
    expect(history.records).toBe(3);
    expect(oceanChanges(history).map((action) => [action.pid, action.index, action.old, action.new])).toEqual([
        [7, 300, 1, 0],
        [7, 2, 0, 5],
    ]);
    expect(entityActions(history, 1).map((action) => [action.pid, [...action.blob]])).toEqual([
        [9, [1, 2, 3]],
        [9, [4, 5]],
    ]);
    expect(history.hero).toEqual([8, 9, 0]);
    expect(history.heroAt.length).toBe(2);
});

test('the level-start record ranks oldest', () => {
    const history = parseHistory(historyFile([FIRST, SECOND], ['Guy'], [0, 0, [3, 4, 0], [change(9, [6])]]).buf);
    expect(history.error).toBeNull();
    const keys = entityActions(history, 1).map((action) => [[...action.blob][0], action.key]);
    expect(keys.map(([firstByte]) => firstByte)).toEqual([1, 4, 6]);
    expect(keys[2][1]).toBe(0);
    expect(keys[2][1]).toBeLessThan(Math.min(keys[0][1], keys[1][1]));
    expect(history.hero).toEqual([8, 9, 0]);
});

test('a cut file keeps the records read whole', () => {
    const { buf, ends } = historyFile([FIRST, SECOND]);
    const history = parseHistory(buf.subarray(0, ends[1] - 3));
    expect(history.records).toBe(1);
    expect(history.actions.length).toBe(3);
    expect(oceanChanges(history).length).toBe(2);
    expect(history.hero).toEqual([5, 6, 0]);
    expect(history.error).toMatch(/v73, mip level 0 record 2 of 2 at byte \d+\); kept the records before it$/);
    // nothing read whole: the reader throws
    expect(() => parseHistory(buf.subarray(0, ends[0] - 3))).toThrow(/mip level 0 record 1 of 2/);
});

test('an unknown action type names its own byte, and bytes after the trailer are reported', () => {
    const { buf, ends } = historyFile([FIRST, SECOND]);
    const bad = buf.slice(),
        at = ends[1] - 23; // the second record's CHANGE: type, pid, type index, blob length, 2-byte blob
    expect(bad[at]).toBe(1);
    bad[at] = 54;
    const history = parseHistory(bad);
    expect(history.records).toBe(1);
    expect(history.error).toContain(`unknown undo action type 54 at byte ${at}`);
    const long = new Uint8Array(buf.length + 2);
    long.set(buf);
    const longHistory = parseHistory(long);
    expect(longHistory.records).toBe(3);
    expect(longHistory.error).toMatch(/^2 bytes left after the trailer \(v73, the trailer at byte \d+\)$/);
});

// the records after the one under test must still line up: SECOND's CHANGE and hero are read from the right bytes
function readsInStep(entry: RecordEntry) {
    const history = parseHistory(historyFile([entry, SECOND]).buf);
    expect(history.error).toBeNull();
    expect(history.records).toBe(3);
    expect(history.actions.map((action) => [action.type, action.pid])).toEqual([
        [1, 9],
        [1, 9],
    ]);
    expect(history.hero).toEqual([8, 9, 0]);
}
const ONE_CHANGE: [first: number, span: number, hero: Position, actions: WriteAction[]] = [
    10,
    1,
    [5, 6, 0],
    [change(9, [1])],
];

test('a v2 move transaction has no lily group index byte', () => {
    readsInStep([
        ...ONE_CHANGE,
        {
            txs: [
                [2, [0]],
                [3, [0, 0]],
            ],
        },
    ]);
});

test('single moves skip their deprecated charm Move_Infos, 80 bytes each', () => {
    readsInStep([...ONE_CHANGE, { txs: [[3, [2, 0, 1]]] }]);
});

test('lily groups skip their entries, and a count byte of 0x80 or more reads no groups', () => {
    readsInStep([
        ...ONE_CHANGE,
        {
            lily: [
                2,
                [
                    [1, 2],
                    [0, 3],
                ],
            ],
        },
    ]);
    readsInStep([...ONE_CHANGE, { lily: [0x80, []] }]);
    readsInStep([...ONE_CHANGE, { lily: [0xff, []] }]);
});

test('an ocean change index is unsigned', () => {
    const history = parseHistory(
        historyFile([[10, 1, [5, 6, 0], [ocean(7, 0x80000000, 0, 1), ocean(7, 0xffffffff, 1, 0)]]]).buf,
    );
    expect(history.error).toBeNull();
    expect(oceanChanges(history).map((action) => action.index)).toEqual([0x80000000, 0xffffffff]);
});

const creation =
    (pid: number, entityType: number, blob: number[], destroyed: number): WriteAction =>
    (writer) =>
        writer.u8(2).u32(pid).s64(entityType).s64(blob.length).bytes(blob).u8(destroyed);
// a Rock diff blob (base and type version 1) with the given [base field index, f32 value] pairs
function rockBlob(fields: Array<[number, number]>) {
    const writer = new Writer().u16(1).u16(1);
    for (const [index, value] of fields)
        writer
            .u16(index)
            .put(4, (view) => view.setFloat32(0, value, true))
            .u8(0xfd);
    return [...writer.done()];
}

test('CREATION_OR_DESTRUCTION keeps its destroyed byte; latestOf keeps the latest record per pid', () => {
    const records: RecordEntry[] = [
        [
            10,
            1,
            [1, 1, 0],
            [
                creation(
                    5,
                    0,
                    rockBlob([
                        [0, 3],
                        [1, 4],
                    ]),
                    0,
                ),
                creation(6, 0, rockBlob([]), 0),
            ],
        ],
        [11, 1, [1, 2, 0], [creation(6, 0, rockBlob([]), 1)]],
    ];
    const history = parseHistory(historyFile(records, ['Rock']).buf);
    expect(history.error).toBeNull();
    expect(entityActions(history, 2).map((action) => [action.pid, action.destroyed])).toEqual([
        [5, false],
        [6, false],
        [6, true],
    ]);
    const latest = latestOf(history);
    expect(latest.created.get(5)).toEqual({ type: 'Rock', destroyed: false });
    expect(latest.created.get(6)).toEqual({ type: 'Rock', destroyed: true });
    // a created entity's position axis missing from its blob is 0
    expect(['x', 'y', 'z'].map((axis) => rawF32(latest.get(5, 'base.position.' + axis)!))).toEqual([3, 4, 0]);
});

// a CHANGE diff blob at type version `typeVersion` of one u32 field of the type's own (`index`), from 0xffffffff
function ownU32Blob(typeVersion: number, index: number, value: number) {
    return [
        ...new Writer()
            .u16(1)
            .u16(typeVersion)
            .u16(0x1000 | index)
            .u32(0xffffffff)
            .u32(value)
            .u8(0xfd)
            .done(),
    ];
}

test("latestOf keeps a Gem_Slot's flags and a Gem's attached_to_entity_id", () => {
    const slotRecords: RecordEntry[] = [[10, 1, [1, 1, 0], [change(4, ownU32Blob(7, 0, 3))]]];
    const slotLatest = latestOf(parseHistory(historyFile(slotRecords, ['Gem_Slot']).buf));
    expect([...slotLatest.get(4, 'flags')!]).toEqual([3, 0, 0, 0]);
    const gemRecords: RecordEntry[] = [[10, 1, [1, 1, 0], [change(5, ownU32Blob(15, 6, 0))]]];
    const gemLatest = latestOf(parseHistory(historyFile(gemRecords, ['Gem']).buf));
    expect([...gemLatest.get(5, 'attached_to_entity_id')!]).toEqual([0, 0, 0, 0]);
});

test('an Activator reset destroys and creates the same pid in one record: the creation wins', () => {
    const records: RecordEntry[] = [
        [10, 1, [1, 1, 0], [creation(7, 0, rockBlob([[0, 2]]), 0)]],
        [11, 1, [1, 2, 0], [creation(7, 0, rockBlob([]), 1), creation(7, 0, rockBlob([[0, 5]]), 0)]],
    ];
    const latest = latestOf(parseHistory(historyFile(records, ['Rock']).buf));
    expect(latest.created.get(7)).toEqual({ type: 'Rock', destroyed: false });
    expect(rawF32(latest.get(7, 'base.position.x')!)).toBe(5);
});
