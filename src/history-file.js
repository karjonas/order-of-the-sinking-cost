// overworld.history (entity diffs, ocean changes and the hero position)
import { Reader } from './reader.js';

// One undo record: a fixed header, move transactions, lily groups, then undo actions. Move transactions, lily
// groups and scrape changes are skipped by size. Each action gets the record's key: the larger first move + span, then
// the later mip level (STATE.md "Overworld state from the save"); the level-start record after the mip levels
// (Action_Icon START, first move 0, no moves) ranks oldest. A record is applied to h only once it has been read whole.
const HISTORY_VERSIONS = [70, 72, 73];
function readUndoActions(r, h, start, si) {
    const first = r.n64(),
        span = r.u32();
    r.skip(20); // active guy, flags, time
    const hero = [r.s32(), r.s32(), r.s32()],
        key = start ? 0 : (first + span) * 16 + si;
    const out = [];
    for (let n = r.u32(); n > 0; n--) {
        const ver = r.u16();
        r.skip(32 + (ver >= 3 ? 1 : 0)); // times, id, duration, flags, lily group (v3+)
        // single move: u16 version + 145 bytes at every version (versioned members are structs, whose leaves are always written)
        for (let m = r.n64(); m > 0; m--) {
            r.skip(147);
            r.skip(80 * r.n64());
        } // then its deprecated charm Move_Infos
    }
    // lily groups: a signed count byte, so one of 128 or more reads none
    for (let n = r.s8(); n > 0; n--) {
        r.skip(5);
        r.skip(12 * r.u32());
        r.skip(16 * r.u32());
    }
    for (let n = r.u32(); n > 0; n--) {
        const at = r.p,
            type = r.u8();
        if (type === 1 || type === 2) {
            const a = { type, pid: r.u32(), etype: r.n64(), blob: r.bytes(r.n64()), key };
            // CREATION_OR_DESTRUCTION: 1 when the record destroyed the entity (the blob is the entity as it was), 0
            // when it created it
            if (type === 2) a.destroyed = r.u8() === 1;
            out.push(a);
        } else if (type === 3) out.push({ type, pid: r.u32(), index: r.u32(), old: r.u8(), new: r.u8(), key }); // ocean change, 10 bytes
        else if (type === 4) r.skip(9); // scrape change: s16 x, y, z, u8 old, new, axis
        else throw new Error(`unknown undo action type ${type} at byte ${at}`);
    }
    if (span && (hero[0] || hero[1] || hero[2])) {
        h.heroes.set(hero.join(','), hero);
        h.heroAt.push([key, hero, start]);
        if (!(h.heroKey >= key)) {
            h.hero = hero;
            h.heroKey = key;
        }
    }
    for (const a of out) {
        a.start = start;
        h.actions.push(a);
    }
    h.records++;
}
// A file that stops parsing keeps the records read before the bad one; h.error says where it stopped and h.records
// counts the records read whole
export function parseHistory(buf) {
    // heroes: every position a kept record shows the hero at, by "x,y,z"; heroAt: [record key, position, whether it is the level-start record] per record
    const r = new Reader(buf),
        h = {
            version: r.u32(),
            types: [],
            actions: [],
            hero: null,
            heroKey: -1,
            heroes: new Map(),
            heroAt: [],
            records: 0,
            error: null,
        };
    const vtag = HISTORY_VERSIONS.includes(h.version) ? `v${h.version}` : `v${h.version}, which the game does not load`;
    r.skip(12); // level data version, base entity version
    for (let n = r.n64(); n > 0; n--) h.types.push({ name: r.str64(), version: r.n64() });
    r.skip(24); // move counters
    const mips = r.u8();
    let where, start;
    try {
        for (let si = 0; si < mips; si++) {
            where = `mip level ${si} header`;
            start = r.p;
            r.skip(14);
            const c = r.n64();
            for (let i = 0; i < c; i++) {
                where = `mip level ${si} record ${i + 1} of ${c}`;
                start = r.p;
                readUndoActions(r, h, false, si);
            }
        }
        where = 'the level-start record';
        start = r.p;
        readUndoActions(r, h, true, 0);
        where = 'the trailer';
        start = r.p;
        r.skip(16); // active hero, next pid serials
        if (r.left) throw new Error(`${r.left} bytes left after the trailer`);
    } catch (err) {
        const msg = `${err.message} (${vtag}, ${where} at byte ${start})`;
        if (!h.records) throw new Error(msg, { cause: err });
        h.error = msg + (where === 'the trailer' ? '' : '; kept the records before it');
    }
    return h;
}
