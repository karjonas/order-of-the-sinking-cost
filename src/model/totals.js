// The totals the page shows: treasures, ice gates, fast-travel pads, gold rooms, voice logs and map scrolls, each over
// the things not under fog or already found; gold rooms only once visited (PROGRESSION.md "Treasures and gold rooms",
// "In-game progress displays")
import { PROG } from '../data.js';
import { latestFlag } from '../save.js';
import { AREA_LAYERS, FOG_LAYER_KEYS, layerName, mapLayerOf } from './layers.js';

function popcount(v) {
    let c = 0;
    for (v >>>= 0; v; v &= v - 1) c++;
    return c;
}

const layerKey = (t) => FOG_LAYER_KEYS[t.l];

// "Ground 70 / 90 · Sky 17 / 35" per total, over the layers the fog has uncovered (`known`, null when nothing is
// hidden): list holds [layer key, found] per thing
function layerSplit(list, known) {
    return [...AREA_LAYERS, 'other']
        .map((k) => {
            const xs = list.filter(([l]) => (l || 'other') === k);
            return [k, xs.filter((x) => x[1]).length, xs.length];
        })
        .filter(([k, , n]) => n && (!known || k === 'other' || known.includes(k)))
        .map(([k, a, n]) => `${k === 'other' ? 'Elsewhere' : layerName(k)} ${a} / ${n}`)
        .join(' · ');
}

// what a totals row frames on the map: the [x, y, z] of the things not found yet that are not under fog, and how many
// more are under fog (`off`: not on the world map)
function findsOf(items, shownAt) {
    const miss = items.filter((x) => !x.found),
        open = miss.filter((x) => x.key && shownAt(x.key, x.p));
    return {
        open: open.map((x) => x.p),
        fogged: miss.filter((x) => x.key).length - open.length,
        off: miss.filter((x) => !x.key).length,
    };
}

// shownAt(key, p): whether a thing at p on layer key is not under fog
export function totalsOf({ status, progress, hide, shownAt, known }) {
    const teleporters = PROG.teleporters || [],
        tIdx = new Map(teleporters.map((t, i) => [t.pid, i]));
    const padDisc = (ti) =>
        progress.tst[ti].disc ||
        (tIdx.has(teleporters[ti].target) && progress.tst[tIdx.get(teleporters[ti].target)].disc);
    const gates = PROG.freezers
        .map((fz, fi) => fi)
        .filter((fi) => !PROG.freezers[fi].judge && shownAt(layerKey(PROG.freezers[fi]), PROG.freezers[fi].p));
    const pads = teleporters
        .map((t, i) => i)
        .filter(
            (i) =>
                teleporters[i].major &&
                layerKey(teleporters[i]) &&
                (padDisc(i) || shownAt(layerKey(teleporters[i]), teleporters[i].p)),
        );
    // with spoilers hidden a gold room is known only once visited: before that its endpoint is a pad like any other
    const rooms = (PROG.gold_rooms || []).filter((gr) => {
        const e = teleporters[gr.endpoint];
        return e && layerKey(e) && (progress.tst[gr.endpoint].disc || !hide);
    });
    // plinth i shows a treasure while more than i treasures are collected
    const nGot = popcount(status.treasureFlags),
        tds = PROG.treasure_displays;
    const plinths = tds && PROG.map ? tds.filter((tr) => tr.i < nGot || shownAt(mapLayerOf(tr.p[2]), tr.p)) : [];
    const treasures = {
        plinths,
        total: tds ? plinths.length : PROG.treasures || 0,
        got: tds ? plinths.filter((tr) => tr.i < nGot).length : Math.min(nGot, PROG.treasures || 0),
    };
    const stats = {
        treasures: [treasures.got, treasures.total],
        gates: [gates.filter((fi) => progress.gateOpen[fi]).length, gates.length],
        tps: [pads.filter(padDisc).length, pads.length],
        gold: [rooms.filter((gr) => progress.tst[gr.endpoint].disc).length, rooms.length],
    };
    const split = (list) => layerSplit(list, known);
    stats.by = {
        treasures: split(plinths.map((tr) => [mapLayerOf(tr.p[2]), tr.i < nGot])),
        gates: split(gates.map((fi) => [layerKey(PROG.freezers[fi]), progress.gateOpen[fi]])),
        tps: split(pads.map((i) => [layerKey(teleporters[i]), padDisc(i)])),
        gold: split(rooms.map((gr) => [layerKey(teleporters[gr.endpoint]), progress.tst[gr.endpoint].disc])),
    };
    // voice logs and map scrolls: shown when not under fog or already found
    const voiceLogs = PROG.voice_logs || [],
        viewGivers = PROG.view_givers || [];
    const heard = (vl) => latestFlag(progress.lt, vl.pid, 'played', vl.d);
    const taken = (vg) => {
        const v = progress.lt?.get(vg.pid, 'activation_order');
        return !!v && v.some((x) => x);
    };
    // two logs sit on the fast-travel screen, off the world map: they count once found, or when nothing is hidden
    const logs = voiceLogs
        .map((vl, i) => i)
        .filter(
            (i) =>
                heard(voiceLogs[i]) ||
                (FOG_LAYER_KEYS[voiceLogs[i].l] ? shownAt(FOG_LAYER_KEYS[voiceLogs[i].l], voiceLogs[i].p) : !hide),
        );
    const maps = viewGivers
        .map((vg, i) => i)
        .filter((i) => taken(viewGivers[i]) || shownAt(FOG_LAYER_KEYS[viewGivers[i].l], viewGivers[i].p));
    stats.logs = [logs.filter((i) => heard(voiceLogs[i])).length, logs.length];
    stats.by.logs = split(logs.map((i) => [FOG_LAYER_KEYS[voiceLogs[i].l], heard(voiceLogs[i])]));
    const finds = {
        gold: findsOf(
            rooms.map((gr) => {
                const endpoint = teleporters[gr.endpoint];
                return { p: endpoint.p, key: layerKey(endpoint), found: progress.tst[gr.endpoint].disc };
            }),
            shownAt,
        ),
        tps: findsOf(
            teleporters
                .map((t, i) => ({ p: t.p, key: t.major && layerKey(t), found: padDisc(i) }))
                .filter((x) => x.key),
            shownAt,
        ),
        logs: findsOf(
            voiceLogs.map((vl) => ({ p: vl.p, key: FOG_LAYER_KEYS[vl.l], found: heard(vl) })),
            shownAt,
        ),
    };
    return { T: teleporters, padDisc, gates, pads, rooms, treasures, stats, logs, maps, heard, taken, finds };
}
