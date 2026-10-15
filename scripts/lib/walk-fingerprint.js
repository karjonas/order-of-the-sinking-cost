// A canonical, deterministic fingerprint of everything the overworld walk computes for one input, to prove that a faster
// replacement of part of the walk changes no answer.
//
// A fingerprint is { digest, hashes, fields }. `fields` holds one canonical value per walk output, `hashes` a short hash
// of each one's text and `digest` a hash of all the hashes, so a comparison names the field that changed. Canonical
// means: object keys sorted, Maps as objects with sorted keys, Sets as sorted arrays, typed arrays as arrays. Arrays
// otherwise keep their order. The iteration order of a Map or a Set is not compared.
//
// The inputs:
//   a save: computeProgress() of a Status and a History, the walker built for the same overworld state, and the walk's
//     reachability result
//   the fresh campaign: the empty save's status and history with the `demo` flag cleared, so the walk runs from the new
//     game's start position
//   NO_HISTORY: the level data alone, walked twice as the page does: every pad on and no Freezer closed (the map's floor
//     heights), and the new game's start (teleporterStatesOf(null), every Freezer closed) that staticRoles() uses
//   staticRoles(): the level roles
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROG, worldReady } from '../../src/data.ts';
import { DEMO_STATUS, demoHistory } from '../../src/demo-save.ts';
import { computeProgress, setProgressCache } from '../../src/model/progress.ts';
import { staticRoles } from '../../src/model/static-roles.ts';
import { parseHistory, parseStatus } from '../../src/save.ts';
import { floorHeights, NO_HISTORY } from '../../src/walk/reachability.ts';
import { teleporterStatesOf } from '../../src/walk/teleporters.ts';
import { walker } from '../../src/walk/walker.ts';
import { walkReady } from '../../src/walk-data.ts';
import { savesDir } from '../saves.js';

const STATUS_FILE = 'Status.sokoban_status';
const HISTORY_FILE = 'overworld.history';
const HASH_LENGTH = 12;
const DIFFERENCE_LINES = 8;
const LISTED_ITEMS = 6;

const PROGRESS_FIELDS = ['state', 'why', 'wayIn', 'wayInFixed', 'access', 'ice', 'behind', 'needed', 'plans', 'goals'];

/** Loads the level data and the stored walk data; await it before fingerprinting. */
export async function walkLoaded() {
    await worldReady;
    await walkReady;
}

function compareCanonical(left, right) {
    if (typeof left === 'number' && typeof right === 'number') return left - right;

    const leftText = JSON.stringify(left);
    const rightText = JSON.stringify(right);
    if (leftText < rightText) return -1;
    if (leftText > rightText) return 1;
    return 0;
}

function canonicalMap(map, ancestors) {
    const entries = [...map].map(([key, item]) => {
        if (typeof key !== 'number' && typeof key !== 'string') throw new Error(`Map key ${String(key)} is no number`);
        return [key, canonical(item, ancestors)];
    });
    entries.sort((left, right) => compareCanonical(left[0], right[0]));

    const plain = {};
    for (const [key, item] of entries) plain[String(key)] = item;
    return plain;
}

function canonicalObject(value, ancestors) {
    const plain = {};
    for (const key of Object.keys(value).toSorted()) plain[key] = canonical(value[key], ancestors);
    return plain;
}

function canonicalContainer(value, ancestors) {
    if (value instanceof Map) return canonicalMap(value, ancestors);
    if (value instanceof Set) return [...value].map((item) => canonical(item, ancestors)).toSorted(compareCanonical);
    if (Array.isArray(value)) {
        const items = [];
        for (let index = 0; index < value.length; index++) items.push(canonical(value[index], ancestors));
        return items;
    }
    return canonicalObject(value, ancestors);
}

/**
 * The canonical form of a value: plain JSON values only, with objects' keys sorted, Maps as objects, Sets as sorted
 * arrays and typed arrays as arrays. What JSON cannot hold is a marker object: `{ $: 'undefined' }`, `{ $: 'NaN' }`,
 * `{ $: 'function' }` and `{ $bigint: digits }`.
 */
export function canonical(value, ancestors = new Set()) {
    if (value === undefined) return { $: 'undefined' };
    if (value === null) return null;
    if (typeof value === 'function') return { $: 'function' };
    if (typeof value === 'bigint') return { $bigint: value.toString() };
    if (typeof value === 'number') {
        if (Number.isFinite(value)) return value;
        return { $: String(value) };
    }
    if (typeof value !== 'object') return value;
    if (ArrayBuffer.isView(value)) return Array.from(value, (item) => canonical(item, ancestors));
    if (ancestors.has(value)) throw new Error('a value that contains itself has no canonical form');

    ancestors.add(value);
    const plain = canonicalContainer(value, ancestors);
    ancestors.delete(value);
    return plain;
}

function sha256(text) {
    return createHash('sha256').update(text).digest('hex');
}

/** The fingerprint of a record of walk outputs, by field name. */
export function fingerprintOf(outputs) {
    const fields = {};
    const hashes = {};
    const digestLines = [];

    for (const name of Object.keys(outputs).toSorted()) {
        fields[name] = canonical(outputs[name]);
        hashes[name] = sha256(JSON.stringify(fields[name])).slice(0, HASH_LENGTH);
        digestLines.push(`${name} ${hashes[name]}`);
    }

    return { digest: sha256(digestLines.join('\n')).slice(0, HASH_LENGTH), hashes, fields };
}

/** Per map layer, the columns that are set, as a sorted list: the dense per-column arrays are mostly zero. */
function columnsSet(columnsByLayer) {
    const setColumns = {};
    for (const [layerKey, columns] of Object.entries(columnsByLayer)) {
        setColumns[layerKey] = [];
        for (let column = 0; column < columns.length; column++) {
            if (columns[column] !== 0) setColumns[layerKey].push(column);
        }
    }
    return setColumns;
}

/** Per map layer, the [column, height] pairs of the columns that have a height. */
function heightsSet(heightsByLayer) {
    const heightPairs = {};
    for (const [layerKey, heights] of Object.entries(heightsByLayer)) {
        heightPairs[layerKey] = [];
        for (let column = 0; column < heights.length; column++) {
            if (!Number.isNaN(heights[column])) heightPairs[layerKey].push([column, heights[column]]);
        }
    }
    return heightPairs;
}

/** What a walker computes on its own: the pad linkage, the skip lanes, the hops and the cell sets. */
function walkerOutputs(prefix, walk) {
    const outputs = {};
    outputs[`${prefix}.shown`] = walk.shown.map((padIndices) => padIndices.toSorted((left, right) => left - right));
    outputs[`${prefix}.lanes`] = walk.lanes;
    outputs[`${prefix}.hops`] = walk.hops;
    outputs[`${prefix}.driftHops`] = walk.driftHops;
    outputs[`${prefix}.fire`] = walk.fire;
    outputs[`${prefix}.beam`] = walk.beam;
    outputs[`${prefix}.thru`] = walk.thru;
    outputs[`${prefix}.openBeam`] = walk.openBeam;
    return outputs;
}

/**
 * The walk outputs for a campaign's status and history: the reachability result (`reach.*`, the reached cells as
 * `reach.reached`), what computeProgress derives from it (`progress.*`) and the walker's own outputs (`walker.*`),
 * built for the same overworld state.
 */
export function saveOutputs(status, history) {
    setProgressCache(new WeakMap());
    const progress = computeProgress(status, history);
    const outputs = {};

    for (const name of PROGRESS_FIELDS) outputs[`progress.${name}`] = progress[name];

    if (!progress.reach) return outputs;

    for (const [name, value] of Object.entries(progress.reach)) {
        if (name === 'cols') outputs['reach.cols'] = columnsSet(value);
        else outputs[`reach.${name}`] = value;
    }

    const closedFreezers = progress.gateOpen.map((open) => !open);
    Object.assign(outputs, walkerOutputs('walker', walker(progress.lt, progress.tst, closedFreezers)));
    return outputs;
}

/** The walk outputs for the level data alone (NO_HISTORY): see the header for the two walkers. */
export function noHistoryOutputs() {
    const everyPadOn = PROG.teleporters.map(() => ({ en: true, disc: true }));
    const outputs = {};
    Object.assign(outputs, walkerOutputs('allPadsOn', walker(NO_HISTORY, everyPadOn, [])));

    const allFreezersClosed = PROG.freezers.map(() => true);
    const startWalker = walker(NO_HISTORY, teleporterStatesOf(null), allFreezersClosed);
    Object.assign(outputs, walkerOutputs('start', startWalker));

    outputs['floorHeights'] = heightsSet(floorHeights());
    return outputs;
}

/** The walk outputs of staticRoles(). */
export function staticRolesOutputs() {
    const roles = staticRoles();
    return {
        'need.l': roles.need.l,
        'need.g': roles.need.g,
        'bg.l': roles.bg.l,
        'bg.g': roles.bg.g,
    };
}

/** The empty save with its `demo` flag cleared, so the walk runs from the new game's start: { status, history }. */
export function freshCampaign() {
    return { status: DEMO_STATUS, history: { ...demoHistory(), demo: false } };
}

/** The folder of a campaign: a folder path as given, else a campaign name in the saves folder. */
export function saveFolderOf(input) {
    if (existsSync(input) && statSync(input).isDirectory()) return resolve(input);
    return join(savesDir(), input);
}

/** Reads a campaign folder's status and history in place: { status, history }. */
export function readSaveFolder(folder) {
    const statusFile = join(folder, STATUS_FILE);
    const historyFile = join(folder, HISTORY_FILE);
    if (!existsSync(statusFile)) throw new Error(`no ${STATUS_FILE} in ${folder}`);
    if (!existsSync(historyFile)) throw new Error(`no ${HISTORY_FILE} in ${folder}`);

    const status = parseStatus(new Uint8Array(readFileSync(statusFile)));
    const history = parseHistory(new Uint8Array(readFileSync(historyFile)));
    return { status, history };
}

/** The text of a fingerprint file: JSON with one field per line, so a text diff names the field. */
export function fingerprintText(fingerprint) {
    const hashLines = Object.entries(fingerprint.hashes).map(([name, hash]) => `${JSON.stringify(name)}: "${hash}"`);
    const fieldLines = Object.entries(fingerprint.fields).map(
        ([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`,
    );
    return [
        '{',
        `"digest": "${fingerprint.digest}",`,
        `"hashes": {\n${hashLines.join(',\n')}\n},`,
        `"fields": {\n${fieldLines.join(',\n')}\n}`,
        '}',
        '',
    ].join('\n');
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describeNumberLists(before, after, path, lines) {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    const removed = before.filter((item) => !afterSet.has(item));
    const added = after.filter((item) => !beforeSet.has(item));
    const parts = [];
    if (removed.length > 0) parts.push(`${removed.length} only before [${removed.slice(0, LISTED_ITEMS).join(', ')}]`);
    if (added.length > 0) parts.push(`${added.length} only after [${added.slice(0, LISTED_ITEMS).join(', ')}]`);

    if (parts.length > 0) {
        lines.push(`${path}: ${parts.join(', ')}`);
        return;
    }

    if (before.length !== after.length) {
        lines.push(`${path}: same items, length ${before.length} -> ${after.length}`);
        return;
    }

    let shown = 0;
    for (let index = 0; index < before.length && shown < LISTED_ITEMS; index++) {
        if (before[index] === after[index]) continue;
        lines.push(`${path}[${index}]: ${before[index]} -> ${after[index]}`);
        shown++;
    }
}

function describeArrays(before, after, path, lines) {
    if (before.every(Number.isFinite) && after.every(Number.isFinite)) {
        describeNumberLists(before, after, path, lines);
        return;
    }

    if (before.length !== after.length) lines.push(`${path}: length ${before.length} -> ${after.length}`);

    const common = Math.min(before.length, after.length);
    for (let index = 0; index < common && lines.length < DIFFERENCE_LINES; index++) {
        describeDifference(before[index], after[index], `${path}[${index}]`, lines);
    }
}

function describeObjects(before, after, path, lines) {
    const beforeKeys = Object.keys(before);
    const afterKeys = Object.keys(after);
    const removed = beforeKeys.filter((key) => !(key in after));
    const added = afterKeys.filter((key) => !(key in before));
    if (removed.length > 0) lines.push(`${path}: keys only before [${removed.slice(0, LISTED_ITEMS).join(', ')}]`);
    if (added.length > 0) lines.push(`${path}: keys only after [${added.slice(0, LISTED_ITEMS).join(', ')}]`);

    for (const key of beforeKeys) {
        if (lines.length >= DIFFERENCE_LINES) return;
        if (key in after) describeDifference(before[key], after[key], `${path}.${key}`, lines);
    }
}

/** Appends to `lines` where two canonical values differ, at most DIFFERENCE_LINES lines in all. */
function describeDifference(before, after, path, lines) {
    if (lines.length >= DIFFERENCE_LINES) return;
    if (JSON.stringify(before) === JSON.stringify(after)) return;

    if (Array.isArray(before) && Array.isArray(after)) {
        describeArrays(before, after, path, lines);
    } else if (isPlainObject(before) && isPlainObject(after)) {
        describeObjects(before, after, path, lines);
    } else {
        lines.push(`${path}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    }
}

/**
 * Compares two fingerprints: the lines that name each field that differs, with where it differs, or an empty list when
 * they are identical.
 */
export function diffFingerprints(before, after) {
    const lines = [];
    const names = [...new Set([...Object.keys(before.hashes), ...Object.keys(after.hashes)])].toSorted();

    for (const name of names) {
        if (!(name in after.hashes)) {
            lines.push(`${name}: only in the first (${before.hashes[name]})`);
        } else if (!(name in before.hashes)) {
            lines.push(`${name}: only in the second (${after.hashes[name]})`);
        } else if (before.hashes[name] !== after.hashes[name]) {
            lines.push(`${name}: ${before.hashes[name]} -> ${after.hashes[name]}`);
            const details = [];
            describeDifference(before.fields[name], after.fields[name], name, details);
            for (const detail of details) lines.push(`    ${detail}`);
        }
    }

    return lines;
}
