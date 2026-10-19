// The totals the page shows: treasures, Freezers, signs, fast-travel pads, voice logs and map scrolls, each over the things not
// under fog or already found; and the gold rooms the map rings, with spoilers hidden only once visited
// (PROGRESSION.md "Treasures and gold rooms", "In-game progress displays")
import { PROG } from '../data.ts';
import { latestFlag } from '../save.ts';
import type { GoldRoom, Position, Teleporter, TreasureDisplay, ViewGiver, VoiceLog } from '../types.ts';
import { isDoorway } from './freezer-names.ts';
import { AREA_LAYERS, FOG_LAYER_KEYS, layerName, mapLayerOf } from './layers.ts';
import type { BaseProgress } from './progress.ts';
import { signStateOf } from './unlocking.ts';
import type { SignState } from './unlocking.ts';
import { indicesWhere } from '../util.ts';

/** Whether a thing at a position on a layer (the layer key, undefined for none) is not under fog. */
export type ShownAt = (layer: string | undefined, position: Position) => boolean;

/** Found and total. */
export type FoundOfTotal = [found: number, total: number];

/** The per layer counts of each total, as the page shows them ("Ground 70 / 90 · Sky 17 / 35"). */
export interface TotalsByLayer {
    treasures: string;
    pods: string;
    doorways: string;
    signs: string;
    tps: string;
    towerPads: string;
    logs: string;
    maps: string;
}

export interface TotalsStats {
    treasures: FoundOfTotal;
    pods: FoundOfTotal;
    doorways: FoundOfTotal;
    /** The signs read over the signs shown. */
    signs: FoundOfTotal;
    /** The shown signs whose rule holds and are not read yet. */
    signsReady: number;
    tps: FoundOfTotal;
    /** The discovered pads of the towers that have one, over those not under fog, with the gold rooms' endpoints. */
    towerPads: FoundOfTotal;
    by: TotalsByLayer;
    logs: FoundOfTotal;
    /** The map scrolls taken over the map scrolls shown. */
    maps: FoundOfTotal;
}

export interface TreasureTotals {
    plinths: TreasureDisplay[];
    total: number;
    got: number;
}

export interface Totals {
    teleporters: Teleporter[];
    padDisc: (teleporter: number) => boolean;
    gates: number[];
    pads: number[];
    rooms: GoldRoom[];
    treasures: TreasureTotals;
    stats: TotalsStats;
    logs: number[];
    maps: number[];
    heard: (log: VoiceLog) => boolean;
    taken: (giver: ViewGiver) => boolean;
}

function popcount(value: number): number {
    let remaining = value >>> 0;
    let count = 0;
    while (remaining) {
        remaining &= remaining - 1;
        count++;
    }

    return count;
}

const layerKey = (thing: { l: number }): string | undefined => FOG_LAYER_KEYS[thing.l];

// "Ground 70 / 90 · Sky 17 / 35" per total, over the layers the fog has uncovered (`known`, null when nothing is
// hidden): list holds [layer key, found] per thing
function layerSplit(list: Array<[layer: string | undefined, found: boolean]>, known: string[] | null): string {
    const parts: string[] = [];
    for (const layer of [...AREA_LAYERS, 'other']) {
        const things = list.filter(([thingLayer]) => (thingLayer || 'other') === layer);
        if (things.length === 0) continue;
        if (known && layer !== 'other' && !known.includes(layer)) continue;

        const found = things.filter(([, thingFound]) => thingFound).length;
        const name = layer === 'other' ? 'Elsewhere' : layerName(layer);
        parts.push(`${name} ${found} / ${things.length}`);
    }

    return parts.join(' · ');
}

/** The totals the page shows; shownAt(key, p): whether a thing at p on layer key is not under fog. */
export function totalsOf({
    status,
    progress,
    hide,
    shownAt,
    known,
    towerHidden = [],
}: {
    status: { treasureFlags: number };
    progress: BaseProgress;
    hide: boolean;
    shownAt: ShownAt;
    known: string[] | null;
    towerHidden?: boolean[];
}): Totals {
    const teleporters = PROG.teleporters || [];
    const teleporterIndex = new Map(teleporters.map((teleporter, i): [number, number] => [teleporter.pid, i]));
    const padDisc = (padIndex: number): boolean => {
        if (progress.tst[padIndex].disc) return true;
        const targetIndex = teleporterIndex.get(teleporters[padIndex].target);
        return targetIndex !== undefined && progress.tst[targetIndex].disc;
    };

    const gates = indicesWhere(PROG.freezers, (freezer) => !freezer.judge && shownAt(layerKey(freezer), freezer.p));

    const pads = indicesWhere(teleporters, (teleporter, i) => {
        if (!teleporter.major || !layerKey(teleporter)) return false;
        return padDisc(i) || shownAt(layerKey(teleporter), teleporter.p);
    });

    // with spoilers hidden a gold room is known only once visited: before that its endpoint is a pad like any other
    const rooms = (PROG.gold_rooms || []).filter((room) => {
        const endpoint = teleporters[room.endpoint];
        return endpoint && layerKey(endpoint) && (progress.tst[room.endpoint].disc || !hide);
    });

    // plinth i shows a treasure while more than i treasures are collected
    const gotCount = popcount(status.treasureFlags);
    const treasureDisplays = PROG.treasure_displays;
    const plinths =
        treasureDisplays && PROG.map
            ? treasureDisplays.filter((display) => display.i < gotCount || shownAt(mapLayerOf(display.p[2]), display.p))
            : [];
    const treasures = {
        plinths,
        total: treasureDisplays ? plinths.length : PROG.treasures || 0,
        got: treasureDisplays
            ? plinths.filter((display) => display.i < gotCount).length
            : Math.min(gotCount, PROG.treasures || 0),
    };

    // the Freezers by model, each its own row: the pods (ice cages) and the doorways (ice gates)
    const pods = gates.filter((freezerIndex) => !isDoorway(freezerIndex));
    const doorways = gates.filter((freezerIndex) => isDoorway(freezerIndex));

    // the signs that open Freezers, under the same fog rule as the Freezers; the tower status signs open none
    const allSigns = PROG.signs || [];
    const openers = indicesWhere(allSigns, (sign) => !sign.status);
    const signs = openers.filter((i) => shownAt(layerKey(allSigns[i]), allSigns[i].p));

    // voice logs and map scrolls: shown when not under fog or already found
    const voiceLogs = PROG.voice_logs || [];
    const viewGivers = PROG.view_givers || [];
    const heard = (log: VoiceLog) => latestFlag(progress.lt, log.pid, 'played', log.d);
    const taken = (giver: ViewGiver) => {
        const order = progress.lt?.get(giver.pid, 'activation_order');
        return !!order && order.some((value) => value);
    };

    // two logs sit on the fast-travel screen, off the world map: they count once found, or when nothing is hidden
    const logs = indicesWhere(voiceLogs, (log) => {
        if (heard(log)) return true;

        const logLayer = FOG_LAYER_KEYS[log.l];
        return logLayer ? shownAt(logLayer, log.p) : !hide;
    });

    const maps = indicesWhere(viewGivers, (giver) => taken(giver) || shownAt(FOG_LAYER_KEYS[giver.l], giver.p));

    // the towers with a pad of their own that are not under fog
    const padTowers = indicesWhere(
        progress.towers,
        (tower, towerIndex) => tower.pad !== undefined && !towerHidden[towerIndex],
    );
    const towerPadFound = (towerIndex: number): boolean => {
        const pad = progress.towers[towerIndex].pad;
        return pad !== undefined && padDisc(pad);
    };
    const towerPadLayer = (towerIndex: number): string | undefined => {
        const pad = progress.towers[towerIndex].pad;
        if (pad === undefined) return undefined;
        return layerKey(teleporters[pad]);
    };
    const roomVisited = (room: GoldRoom): boolean => progress.tst[room.endpoint].disc;
    const roomLayers = rooms.map((room): [string | undefined, boolean] => [
        layerKey(teleporters[room.endpoint]),
        roomVisited(room),
    ]);

    const split = (list: Array<[layer: string | undefined, found: boolean]>) => layerSplit(list, known);
    const freezerSplit = (indices: number[]) =>
        split(
            indices.map((freezerIndex): [string | undefined, boolean] => [
                layerKey(PROG.freezers[freezerIndex]),
                progress.gateOpen[freezerIndex],
            ]),
        );
    const signState = (signIndex: number): SignState => signStateOf(progress, allSigns[signIndex]);
    const signMet = (signIndex: number): boolean => signState(signIndex) === 'read';
    const signReady = (signIndex: number): boolean => signState(signIndex) === 'ready';
    const stats: TotalsStats = {
        treasures: [treasures.got, treasures.total],
        pods: [pods.filter((freezerIndex) => progress.gateOpen[freezerIndex]).length, pods.length],
        doorways: [doorways.filter((freezerIndex) => progress.gateOpen[freezerIndex]).length, doorways.length],
        signs: [signs.filter(signMet).length, signs.length],
        signsReady: signs.filter(signReady).length,
        tps: [pads.filter(padDisc).length, pads.length],
        towerPads: [
            padTowers.filter(towerPadFound).length + rooms.filter(roomVisited).length,
            padTowers.length + rooms.length,
        ],
        maps: [maps.filter((i) => taken(viewGivers[i])).length, maps.length],
        by: {
            treasures: split(
                plinths.map((display): [string | undefined, boolean] => [
                    mapLayerOf(display.p[2]),
                    display.i < gotCount,
                ]),
            ),
            pods: freezerSplit(pods),
            doorways: freezerSplit(doorways),
            signs: split(signs.map((i): [string | undefined, boolean] => [layerKey(allSigns[i]), signMet(i)])),
            tps: split(pads.map((i): [string | undefined, boolean] => [layerKey(teleporters[i]), padDisc(i)])),
            towerPads: split([
                ...padTowers.map((i): [string | undefined, boolean] => [towerPadLayer(i), towerPadFound(i)]),
                ...roomLayers,
            ]),
            logs: split(
                logs.map((i): [string | undefined, boolean] => [FOG_LAYER_KEYS[voiceLogs[i].l], heard(voiceLogs[i])]),
            ),
            maps: split(
                maps.map((i): [string | undefined, boolean] => [FOG_LAYER_KEYS[viewGivers[i].l], taken(viewGivers[i])]),
            ),
        },
        logs: [logs.filter((i) => heard(voiceLogs[i])).length, logs.length],
    };

    return { teleporters, padDisc, gates, pads, rooms, treasures, stats, logs, maps, heard, taken };
}
