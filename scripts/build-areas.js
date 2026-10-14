// Groups the overworld Level_Entries by local area (Area_Pin) the way the game picks the current area.
//
// Reads <game>/data/levels.package (overworld) and <game>/data/strings/en.localization (area names).
// Writes data/level_areas.json.
//
// Usage: node scripts/build-areas.js [--game DIR]
import { existsSync, readFileSync } from 'node:fs';
import { get, refOf } from './lib/fields.js';
import { roundTo } from './lib/math.js';
import { writeJsonAtomic } from './lib/output.js';
import { Package, pidString } from './lib/package.js';
import * as paths from './lib/paths.js';

const RULE = `Groups the overworld Level_Entries by local area (Area_Pin) the way the game picks the current area.

Game rule (markers.jai, per frame): every Marker with script_name "local_area" whose oriented box
(position, orientation, scale, props.box_extents; x/y deltas wrapped by the grid size) contains the hero
is a candidate; the candidate with the lowest float_parameter whose target Area_Pin (script_target_entity_id)
is activated becomes the current area, else there is none. Here every pin counts as activated, and the test
point is the Level_Entry position (the hero enters a level from the entry's own cell). An entry in boxes of
more than one area lists them in 'overlap' ([local_area_name, float_parameter] in record order): the viewer
picks among them by the save's activated pins.

Entries outside every box get no area from the game; for them 'nearest_*' and 'margin' (distance outside
the closest box, max over axes) give a fallback grouping.`;

const OVERWORLD_TYPES = new Set(['Marker', 'Area_Pin', 'Level_Entry', 'Settings', 'Camera_Marker']);
const POSITION_PLACES = 3;
const BOX_PLACES = 4;
// How much of a box's extent the level entry may lie outside of and still count for the fallback histogram
const HISTOGRAM_LIMIT = 30;

// The `key` / value blocks of a localization file: a key line starts with a backtick and the lines after it, up to
// the next blank or key line, are its text
function loadLocalization(path) {
    const strings = new Map();
    if (!existsSync(path)) return strings;
    const lines = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n').split('\n');
    let index = 0;
    while (index < lines.length) {
        if (!lines[index].startsWith('`')) {
            index++;
            continue;
        }
        const key = lines[index].slice(1).trim();
        const textLines = [];
        index++;
        while (index < lines.length && lines[index].trim() && !lines[index].startsWith('`')) {
            textLines.push(lines[index]);
            index++;
        }
        strings.set(key, textLines.join('\n'));
    }
    return strings;
}

// Rotates a vector by the inverse of the unit quaternion (x, y, z, w)
function rotateByInverse(quaternion, vector) {
    const x = -quaternion[0];
    const y = -quaternion[1];
    const z = -quaternion[2];
    const w = quaternion[3];
    const [vectorX, vectorY, vectorZ] = vector;
    // twice = 2 * cross(quaternion.xyz, vector); rotated = vector + w * twice + cross(quaternion.xyz, twice)
    const twiceX = 2 * (y * vectorZ - z * vectorY);
    const twiceY = 2 * (z * vectorX - x * vectorZ);
    const twiceZ = 2 * (x * vectorY - y * vectorX);
    return [
        vectorX + w * twiceX + (y * twiceZ - z * twiceY),
        vectorY + w * twiceY + (z * twiceX - x * twiceZ),
        vectorZ + w * twiceZ + (x * twiceY - y * twiceX),
    ];
}

function vectorOf(fields, prefix, fallbacks) {
    return ['x', 'y', 'z'].map((axis, i) => get(fields, prefix + axis, fallbacks[i]));
}

// A local_area Marker: an oriented box with a priority, aimed at an Area_Pin
class AreaBox {
    constructor(pid, fields, order) {
        this.pid = pid;
        this.order = order;
        this.position = vectorOf(fields, 'base.position.', [0, 0, 0]);
        this.orientation = [...vectorOf(fields, 'base.orientation.', [0, 0, 0]), get(fields, 'base.orientation.w', 1)];
        this.scale = vectorOf(fields, 'base.scale.', [1, 1, 1]);
        this.extents = vectorOf(fields, 'props.box_extents.', [0, 0, 0]);
        this.priority = get(fields, 'float_parameter', 0);
        this.target = refOf(get(fields, 'script_target_entity_id', 0));
        this.isPoint = get(fields, 'is_point_marker', true);
    }

    // Per-axis distance outside the box (<= 0 on every axis = inside)
    margin(point, wrapOf) {
        const delta = point.map((value, i) => value - this.position[i]);
        const wrap = wrapOf(this);
        for (const i of [0, 1]) {
            if (!wrap[i]) continue;
            if (delta[i] > 0.5 * wrap[i]) delta[i] -= wrap[i];
            else if (delta[i] < -0.5 * wrap[i]) delta[i] += wrap[i];
        }
        const local = rotateByInverse(this.orientation, delta);
        return local.map((value, i) => {
            const scaled = this.scale[i] !== 0 ? value / this.scale[i] : value;
            return Math.abs(scaled) - this.extents[i];
        });
    }

    contains(point, wrapOf) {
        return Math.max(...this.margin(point, wrapOf)) <= 0;
    }
}

// The containing box with the lowest priority; the first one wins a tie
function pickBox(boxes, point, wrapOf) {
    let best = null;
    for (const box of boxes) {
        if (!box.contains(point, wrapOf)) continue;
        if (best === null || box.priority < best.priority) best = box;
    }
    return best;
}

// The box with the smallest outside distance (max over axes), preferring the lower priority, then the earlier one
function nearestBox(boxes, point, wrapOf) {
    let best = null;
    for (const box of boxes) {
        const candidate = { distance: Math.max(...box.margin(point, wrapOf)), box };
        if (best === null || isCloser(candidate, best)) best = candidate;
    }
    return best;
}

function isCloser(candidate, best) {
    if (candidate.distance !== best.distance) return candidate.distance < best.distance;
    if (candidate.box.priority !== best.box.priority) return candidate.box.priority < best.box.priority;
    return candidate.box.order < best.box.order;
}

// The Area_Pin a picked box aims at, null when no box was picked
function targetOf(box) {
    if (box === null) return null;
    return box.target;
}

function roundedList(values, places) {
    return values.map((value) => roundTo(value, places));
}

function increment(counter, key) {
    counter.set(key, (counter.get(key) ?? 0) + 1);
}

function readOverworld(pkg) {
    const { header, records } = pkg.rawEntities('overworld');
    const overworld = { settings: {}, boxes: [], pins: new Map(), entries: [], markers: new Map(), fastTravel: [] };
    for (const { pid, type, blob } of records) {
        const [name, typeVersion] = header.types[type];
        if (!OVERWORLD_TYPES.has(name)) continue;
        const fields = pkg.decode(blob, name, typeVersion, header.base);
        if (name === 'Settings') overworld.settings = fields;
        else if (name === 'Camera_Marker') {
            if (fields.overhead_map_type === 'FAST_TRAVEL') overworld.fastTravel.push(fields);
        } else if (name === 'Marker') {
            overworld.markers.set(pid, fields);
            if (fields.script_name === 'local_area') {
                overworld.boxes.push(new AreaBox(pid, fields, overworld.boxes.length));
            }
        } else if (name === 'Area_Pin') overworld.pins.set(pid, fields);
        else if (name === 'Level_Entry') overworld.entries.push([pid, fields]);
    }
    return overworld;
}

// Boxes at or above the first fast-travel layer (bottom of the lowest FAST_TRAVEL Camera_Marker, minus 0.5) wrap with
// the fast-travel extents; all others with the grid size
function wrapChooser(settings, fastTravel) {
    const squares = [get(settings, 'grid.squares_x', 0), get(settings, 'grid.squares_y', 0)];
    const gridWrap = settings['grid.wrapping'] ? squares : [0, 0];
    const fastTravelWrap = [get(settings, 'fast_travel_extents.x', 0), get(settings, 'fast_travel_extents.y', 0)];
    let threshold = Infinity;
    if (fastTravel.length) {
        let lowest = fastTravel[0];
        for (const camera of fastTravel) {
            if (get(camera, 'base.position.z', 0) < get(lowest, 'base.position.z', 0)) lowest = camera;
        }
        threshold = get(lowest, 'base.position.z', 0) - Math.abs(get(lowest, 'props.box_extents.z', 0)) - 0.5;
    }
    const wrapOf = (box) => (box.position[2] >= threshold ? fastTravelWrap : gridWrap);
    return { wrapOf, threshold };
}

function buildAreas() {
    const pkg = new Package();
    const localization = loadLocalization(paths.game('data', 'strings', 'en.localization'));
    const { settings, boxes, pins, entries, markers, fastTravel } = readOverworld(pkg);
    pkg.close();
    const { wrapOf, threshold } = wrapChooser(settings, fastTravel);
    const usableBoxes = boxes.filter((box) => pins.has(box.target) && !box.isPoint && box.extents.some(Boolean));
    const badTargets = boxes.filter((box) => !pins.has(box.target)).map((box) => box.pid);

    const areaName = (pinPid) => get(pins.get(pinPid), 'local_area_name', '');
    const displayName = (name) => localization.get(name) ?? null;
    const boxInfo = (box) => ({
        p: roundedList(box.position, BOX_PLACES),
        q: roundedList(box.orientation, BOX_PLACES),
        s: roundedList(box.scale, BOX_PLACES),
        e: roundedList(box.extents, BOX_PLACES),
        f: box.priority,
        w: [...wrapOf(box)],
    });
    const areaInfo = (pinPid) => {
        const pin = pins.get(pinPid);
        const name = areaName(pinPid);
        const labelMarker = refOf(get(pin, 'map_label_marker_id', 0));
        const labelFields = markers.get(labelMarker);
        const hasLabel = labelFields !== undefined && Object.keys(labelFields).length > 0;
        const targeting = usableBoxes.filter((box) => box.target === pinPid);
        return {
            pin: pinPid,
            pin_id: pidString(pinPid),
            local_area_name: name,
            display_name: displayName(name),
            local_area_image: get(pin, 'local_area_image', ''),
            position: roundedList(vectorOf(pin, 'base.position.', [0, 0, 0]), POSITION_PLACES),
            map_label_marker: labelMarker || null,
            map_label_position: hasLabel
                ? roundedList(vectorOf(labelFields, 'base.position.', [0, 0, 0]), POSITION_PLACES)
                : null,
            local_area_markers: targeting.map((box) => box.pid).toSorted((first, second) => first - second),
            local_area_boxes: targeting.map(boxInfo),
        };
    };

    const outEntries = new Map();
    const unlockedBy = new Map();
    const exactCounts = new Map();
    const fallbackCounts = new Map();
    const unassigned = [];
    const tied = [];
    const sensitiveToHeight = [];
    const margins = [];
    for (const [pid, fields] of entries) {
        const point = vectorOf(fields, 'base.position.', [0, 0, 0]);
        const name = get(fields, 'level_name', '');
        const picked = pickBox(usableBoxes, point, wrapOf);
        const pickedAbove = pickBox(usableBoxes, [point[0], point[1], point[2] + 1], wrapOf);
        if (targetOf(pickedAbove) !== targetOf(picked)) sensitiveToHeight.push(name);
        const candidates = usableBoxes.filter((box) => box.contains(point, wrapOf));
        if (
            picked &&
            candidates.some((candidate) => candidate.priority === picked.priority && candidate.target !== picked.target)
        ) {
            tied.push(name);
        }
        const record = { entry: pidString(pid), position: roundedList(point, POSITION_PLACES) };
        if (picked) {
            const pinName = areaName(picked.target);
            Object.assign(record, {
                area_pin: picked.target,
                local_area_name: pinName,
                display_name: displayName(pinName),
                exact: true,
                marker: picked.pid,
                candidates: candidates.length,
            });
            // boxes of more than one area: the named area depends on the save's activated pins (record order)
            if (new Set(candidates.map((box) => box.target)).size > 1) {
                record.overlap = candidates.map((box) => [areaName(box.target), box.priority]);
            }
            increment(exactCounts, picked.target);
            increment(fallbackCounts, picked.target);
        } else {
            const { distance, box } = nearestBox(usableBoxes, point, wrapOf);
            const pinName = areaName(box.target);
            Object.assign(record, {
                area_pin: null,
                local_area_name: null,
                display_name: null,
                exact: false,
                nearest_area_pin: box.target,
                nearest_local_area_name: pinName,
                nearest_display_name: displayName(pinName),
                nearest_marker: box.pid,
                margin: roundTo(distance, POSITION_PLACES),
            });
            unassigned.push(name);
            margins.push(distance);
            increment(fallbackCounts, box.target);
        }
        unlockedBy.set(
            name,
            ['unlocked_by_id', 'unlocked_by_id2', 'unlocked_by_id3']
                .map((key) => fields[key])
                .filter(Array.isArray)
                .map((value) => value[1]),
        );
        outEntries.set(name, record);
    }

    const levelOfEntry = new Map(entries.map(([pid, fields]) => [pid, get(fields, 'level_name', '')]));
    const agreement = new Map();
    for (const [name, record] of outEntries) {
        for (const unlocker of unlockedBy.get(name)) {
            const unlockerName = levelOfEntry.get(unlocker);
            if (unlockerName === undefined || !outEntries.get(unlockerName).exact) continue;
            const mine = record.exact ? record.area_pin : record.nearest_area_pin;
            const key = `${record.exact ? 'exact' : 'fallback'} ${mine === outEntries.get(unlockerName).area_pin}`;
            increment(agreement, key);
        }
    }

    const areas = new Map();
    for (const pinPid of pins.keys()) {
        const area = areaInfo(pinPid);
        area.level_count = exactCounts.get(pinPid) ?? 0;
        area.level_count_with_fallback = fallbackCounts.get(pinPid) ?? 0;
        areas.set(area.local_area_name || area.pin_id, area);
    }
    writeJsonAtomic(
        paths.data('level_areas.json'),
        { rule: RULE, areas, levels: outEntries, unassigned: unassigned.toSorted() },
        { indent: 1 },
    );

    const exactTotal = [...exactCounts.values()].reduce((sum, count) => sum + count, 0);
    const histogram = new Map();
    for (const margin of margins) increment(histogram, Math.min(Math.ceil(margin), HISTOGRAM_LIMIT));
    const withBoxes = new Set(usableBoxes.map((box) => box.target));
    console.log('local_area markers', boxes.length, 'usable', usableBoxes.length, 'bad targets', badTargets.length);
    console.log('pins', pins.size, 'pins with markers', withBoxes.size, 'entries', entries.length);
    console.log('exact', exactTotal, 'unassigned', unassigned.length, 'ties across pins (file order used)', tied);
    console.log('fast-travel layer threshold z', threshold);
    console.log('entries whose area changes if the hero were one unit higher', sensitiveToHeight.length);
    console.log(
        'fallback margin histogram (ceil)',
        [...histogram.entries()].toSorted((first, second) => first[0] - second[0]),
    );
    console.log('unlocker agreement', Object.fromEntries(agreement));
    const withoutExact = [...pins.keys()]
        .filter((pin) => !exactCounts.has(pin))
        .map(areaName)
        .toSorted();
    const withoutAny = [...pins.keys()]
        .filter((pin) => !fallbackCounts.has(pin))
        .map(areaName)
        .toSorted();
    console.log('pins without exact entries', withoutExact);
    console.log('pins without any entries', withoutAny);
}

paths.parseCommandLine();
buildAreas();
