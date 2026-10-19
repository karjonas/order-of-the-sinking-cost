// Builds data/progress.json (overworld levels, unlock gates, towers, areas, map) for the progress view from
// data/levels.json, plus data/level_areas.json, data/fog.json (build-fog.js), map.json (build-map.js) and world.json
// (build-world.js) when present. Rules are described in docs/PROGRESSION.md.
//
// Reads levels.json, level_areas.json, fog.json, map.json and world.json from data/, and the overworld from
// <game>/data/levels.package (type defaults). Writes data/progress.json.
//
// Usage: node scripts/build-progress.js [--game DIR]
import { existsSync, readFileSync, statSync } from 'node:fs';
import { get, refOf } from './lib/fields.js';
import { modulo, roundTo } from './lib/math.js';
import { writeJsonAtomic } from './lib/output.js';
import { Package } from './lib/package.js';
import * as paths from './lib/paths.js';

const FLAG_BITS = { HEROES: 1, MIRRORS: 2, SKIPPING: 4, PROMESST: 8, UPSTAIRS: 16, DOWNSTAIRS: 32 };
const UNLOCK_KEYS = ['unlocked_by_id', 'unlocked_by_id2', 'unlocked_by_id3', 'unlocked_by_id4'];
// The Freezer model B mesh, a doorway; model A (GAME_OVER_Freezer_A) is a pod
const DOORWAY_MESH = 'GAME_OVER_Freezer_B';
const POSITION_PLACES = 2;
const DISTANCE_PLACES = 1;
// Tower_Flags bits that make a tower a high (UPSTAIRS) or low (DOWNSTAIRS) one
const HIGH_OR_LOW = 48;
const LOW = 32;
// The Sign that opens the gold rooms counts as this many solved levels' worth of rank in the viewer
const GOLD_RANK = 4;
// Each layer's crossroads hub: areas are ordered by distance from it
const HUBS = { ground: 'area_g_crossroads', sky: 'area_s_upper_crossroads', underworld: 'area_u_crossroads_low' };
// Level_Entry glow groups by the hue (degrees) of `color_active`; a hue below `below` and not below an earlier one is in
// the group, and the rest (reds above all) fall to orange
const GLOW_GROUPS = [
    { name: 'orange', below: 40 },
    { name: 'yellow', below: 70 },
    { name: 'green', below: 160 },
    { name: 'blue', below: 250 },
    { name: 'purple', below: 340 },
];
// The Level_Entry `style` of the pads drawn as a 16-point star: the tower levels' (and the end1 level's)
const TOWER_PAD_STYLE = 'SIXTEEN_POINTS';
const LAYER_OF_PREFIX = { g: 'ground', s: 'sky', u: 'underworld' };
const LAYER_RANK = ['ground', 'sky', 'underworld'];

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function readOptionalJson(path) {
    if (existsSync(path)) return readJson(path);
    return null;
}

function flagsValue(names) {
    return (names || []).reduce((total, name) => total + FLAG_BITS[name], 0);
}

function positionOf(fields) {
    return ['x', 'y', 'z'].map((axis) => roundTo(get(fields, `base.position.${axis}`, 0), POSITION_PLACES));
}

// The pids a gate's id fields name (the ones that are set)
function gateIds(fields, keys) {
    return keys.map((key) => refOf(fields[key])).filter(Boolean);
}

// The first decoded value of a field in a level's entities of one type, as the type's default (the old value)
function typeDefault(pkg, raw, typeName, field) {
    for (const { type, blob } of raw.records) {
        const [name, version] = raw.header.types[type];
        if (name !== typeName) continue;
        const decoded = pkg.decode(blob, name, version, raw.header.base, { withOld: true });
        if (field in decoded) return decoded[field][0];
    }
    return null;
}

// [{ pid, fields }] of every entity of one type in a level package, without type defaults
function packageEntities(pkg, raw, typeName) {
    const entities = [];
    for (const { pid, type, blob } of raw.records) {
        const [name, version] = raw.header.types[type];
        if (name === typeName) entities.push({ pid, fields: pkg.decode(blob, name, version, raw.header.base) });
    }
    return entities;
}

function hueOf(red, green, blue) {
    const largest = Math.max(red, green, blue);
    const smallest = Math.min(red, green, blue);
    const spread = largest - smallest;
    let sector;
    if (largest === red) {
        sector = ((green - blue) / spread) % 6;
    } else if (largest === green) {
        sector = (blue - red) / spread + 2;
    } else {
        sector = (red - green) / spread + 4;
    }
    return modulo(sector * 60, 360);
}

// The glow group of a Level_Entry: the one its `color_active` hue is nearest to (reds count as orange, cyans as blue,
// magentas as purple)
function glowGroupOf(fields) {
    const hue = hueOf(
        get(fields, 'color_active.x', 0),
        get(fields, 'color_active.y', 0),
        get(fields, 'color_active.z', 0),
    );
    for (const group of GLOW_GROUPS) {
        if (hue < group.below) return group.name;
    }
    return 'orange';
}

function buildLevels(overworld) {
    const entries = overworld.Level_Entry.filter(
        (entry) => !entry.fields.currently_broken && !entry.fields.currently_disfavored,
    );
    const index = new Map(entries.map((entry, i) => [entry.pid, i]));
    const levels = entries.map((entry) => {
        const fields = entry.fields;
        const required = gateIds(fields, UNLOCK_KEYS.slice(0, 3));
        const level = {
            n: fields.level_name,
            p: positionOf(fields),
            req: required.filter((pid) => index.has(pid)).map((pid) => index.get(pid)),
        };
        if (fields.unlock_is_or_gate && required.length > 1) level.or = 1;
        // the game evaluates a gate only while enabled_t_target is 0, so an enabled gated level is open from the start
        if (level.req.length && fields.enabled_t_target === 1) level.en = 1;
        if (fields.tower_flags) level.t = flagsValue(fields.tower_flags);
        level.glow = glowGroupOf(fields);
        if (fields.style === TOWER_PAD_STYLE) level.tower = 1;
        if (fields.dropdown) level.d = 1;
        if (fields.achievement) level.a = fields.achievement;
        return level;
    });
    return { levels, index };
}

function buildTowers(pkg, raw, overworld) {
    const requiredDefault = typeDefault(pkg, raw, 'Tower', 'levels_required');
    if (requiredDefault === null) throw new Error('Tower.levels_required has no type default in the overworld package');
    const towers = overworld.Tower.map((tower) => ({
        pid: tower.pid,
        t: flagsValue(tower.fields.tower_flags),
        req: get(tower.fields, 'levels_required', requiredDefault),
        p: positionOf(tower.fields),
    }));
    return towers.toSorted(towerOrder);
}

// A Tower whose `teleporter_id` is a MINOR pad gets `pad`, the pad's index in `teleporters`: the ground and low towers'
// pads stand on or next to the tower, while a high tower's is a MAJOR pad elsewhere on the map
function addTowerPads(overworld, towers, teleporters) {
    for (const entity of overworld.Tower) {
        const padPid = refOf(entity.fields.teleporter_id);
        const padIndex = teleporters.findIndex((pad) => pad.pid === padPid);
        if (padIndex < 0 || teleporters[padIndex].major) continue;

        const tower = towers.find((candidate) => candidate.pid === entity.pid);
        tower.pad = padIndex;
    }
}

// Plain towers first, then the high ones, then the low ones; by their flags within each
function towerOrder(first, second) {
    const firstHighOrLow = Number((first.t & HIGH_OR_LOW) !== 0);
    const secondHighOrLow = Number((second.t & HIGH_OR_LOW) !== 0);
    if (firstHighOrLow !== secondHighOrLow) return firstHighOrLow - secondHighOrLow;
    const lowDifference = (first.t & LOW) - (second.t & LOW);
    if (lowDifference !== 0) return lowDifference;
    return first.t - second.t;
}

function buildFreezers(overworld, index, towers, layerOf) {
    const signs = new Map((overworld.Sign ?? []).map((sign) => [sign.pid, sign.fields]));
    const towerIndex = (pid) => towers.findIndex((tower) => tower.pid === pid);
    const freezers = overworld.Freezer.map((freezer) => {
        const fields = freezer.fields;
        const ids = gateIds(fields, UNLOCK_KEYS);
        const gate = {
            pid: freezer.pid,
            p: positionOf(fields),
            req: ids.filter((pid) => index.has(pid)).map((pid) => index.get(pid)),
        };
        if (layerOf) gate.l = layerOf(gate.p[2]);
        if (fields.unlock_is_or_gate && ids.length > 1) gate.or = 1;
        if (gate.req.length !== ids.length) {
            // on the overworld the other ids are all Signs
            gate.signs = [];
            for (const pid of ids) {
                if (index.has(pid)) continue;
                const sign = signs.get(pid);
                if (sign === undefined) {
                    gate.signs.push({ pid });
                    continue;
                }
                const rank = sign.unlock_freezers_with_rank || 0;
                if (rank) gate.signs.push({ pid, rank });
                else if (sign.tower_id) gate.signs.push({ pid, tower: towerIndex(sign.tower_id[1]) });
                else if (sign.gold_room_connection_unlocker) gate.signs.push({ pid, gold: GOLD_RANK });
                else gate.signs.push({ pid });
            }
        }
        const partial = fields.partial_solve_count;
        if (partial !== undefined && partial !== null && partial !== -1) gate.partial = 1;
        if (fields.judge_unlock_level) gate.judge = 1;
        if (get(fields, 'base.mesh', '') === DOORWAY_MESH) gate.doorway = 1;
        return gate;
    });
    return { freezers, signs, towerIndex };
}

// Signs that open gates (by rank, tower or gold rooms) and tower status signs, with the gates that list each
function buildSignRows(signs, freezers, towerIndex, layerOf) {
    const rows = [];
    for (const [pid, sign] of signs) {
        const rank = sign.unlock_freezers_with_rank || 0;
        const gates = [];
        freezers.forEach((freezer, i) => {
            if ((freezer.signs ?? []).some((entry) => entry.pid === pid)) gates.push(i);
        });
        const row = { pid, p: positionOf(sign) };
        if (layerOf) row.l = layerOf(row.p[2]);
        if (rank) row.rank = rank;
        else if (gates.length && sign.tower_id) row.tower = towerIndex(sign.tower_id[1]);
        else if (gates.length && sign.gold_room_connection_unlocker) row.gold = GOLD_RANK;
        else if (sign.display_hook === 'TOWER_STATUS' && sign.tower_id) {
            row.tower = towerIndex(sign.tower_id[1]);
            row.status = 1;
        } else continue;
        row.gates = gates;
        rows.push(row);
    }
    return rows;
}

// Each level's first set that is not a drafts set, with its place in the set (levels that exist only)
function assignSets(levelData, levels) {
    const known = new Set(levelData.levels.map((level) => level.name));
    const inSet = new Map();
    for (const [name, allMembers] of Object.entries(levelData.level_sets)) {
        const members = allMembers.filter((member) => known.has(member));
        members.forEach((member, position) => {
            const current = inSet.get(member);
            if (!current || (current[0].startsWith('drafts') && !name.startsWith('drafts'))) {
                inSet.set(member, [name, position + 1, members.length]);
            }
        });
    }
    const table = [];
    for (const level of levels) {
        const found = inSet.get(level.n);
        if (!found) continue;
        let tableIndex = table.findIndex((entry) => entry.name === found[0]);
        if (tableIndex < 0) {
            table.push({ name: found[0], n: found[2] });
            tableIndex = table.length - 1;
        }
        level.set = [tableIndex, found[1]];
    }
    return table;
}

// The ways into the endgame areas, which the walk does not find (PROGRESSION.md "Endings"), from the gate unlockers and
// positions: rows [level, gates, replace], where replace says the gates stand in for the walk's way-in gates rather
// than filling in for none.
// - The level that earns ENDGAME1 stands inside the gates of the gold room Sign.
// - The endgame2 room is entered from below, through the gates of the sky towers' Signs under it (inside the x, y span
//   of its levels); the level that earns ENDGAME2 lies above the room, behind the set's gates higher than the room.
// - The endgame3 rooms form one chain in set order: a level lies behind the gates opened only by levels before it in
//   the set (the latest of those), leaving out a gate whose levels need the level itself; the first room has none.
function buildEndgameWayIns(levels, sets, freezers, signRows, towers) {
    const rows = [];
    const membersOf = (name) => {
        const setIndex = sets.findIndex((set) => set.name === name);
        const members = levels.map((level, i) => i).filter((i) => levels[i].set?.[0] === setIndex);
        return members.toSorted((first, second) => levels[first].set[1] - levels[second].set[1]);
    };
    // the gates opened by levels of the set alone, no sign
    const setGates = (members) =>
        freezers
            .map((freezer, fi) => fi)
            .filter((fi) => {
                const freezer = freezers[fi];
                return !freezer.signs?.length && freezer.req.length && freezer.req.every((j) => members.includes(j));
            });
    const gold = signRows.find((row) => row.gold);
    levels.forEach((level, i) => {
        if (level.a === 'ENDGAME1' && gold) rows.push([i, gold.gates, 1]);
    });

    const room = membersOf('endgame2');
    const high = room.find((i) => levels[i].a === 'ENDGAME2');
    const floor = room.filter((i) => i !== high);
    if (floor.length) {
        const span = (axis) => [
            Math.min(...floor.map((i) => levels[i].p[axis])),
            Math.max(...floor.map((i) => levels[i].p[axis])),
        ];
        const [[x0, x1], [y0, y1]] = [span(0), span(1)];
        const roomZ = Math.min(...floor.map((i) => levels[i].p[2]));
        const within = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
        const lift = [];
        for (const row of signRows) {
            if (row.tower == null || !(towers[row.tower].t & 16) || !within(row.p) || row.p[2] >= roomZ) continue;
            lift.push(...row.gates);
        }
        for (const i of floor) rows.push([i, lift.toSorted((a, b) => a - b), 0]);
        if (high !== undefined) {
            const above = setGates(room).filter((fi) => freezers[fi].p[2] > roomZ && !freezers[fi].req.includes(high));
            rows.push([high, above, 1]);
        }
    }

    const chain = membersOf('endgame3');
    const place = new Map(chain.map((i, n) => [i, n]));
    // the set's levels that need level i: requiring it, or a level that does
    const needing = (i) => {
        const out = new Set([i]);
        for (let grew = true; grew;) {
            grew = false;
            for (const j of chain)
                if (!out.has(j) && levels[j].req.some((r) => out.has(r))) {
                    out.add(j);
                    grew = true;
                }
        }
        return out;
    };
    const chainGates = setGates(chain);
    for (const i of chain) {
        const needs = needing(i);
        const before = chainGates.filter((fi) => {
            const opener = freezers[fi].req;
            return opener.every((j) => place.get(j) < place.get(i)) && !opener.some((j) => needs.has(j));
        });
        const latest = Math.max(-1, ...before.map((fi) => Math.max(...freezers[fi].req.map((j) => place.get(j)))));
        const gates = before.filter((fi) => Math.max(...freezers[fi].req.map((j) => place.get(j))) === latest);
        rows.push([i, gates, 1]);
    }
    return rows.toSorted((first, second) => first[0] - second[0]);
}

// Distance around the world's wrap: the shorter way between two coordinates that are `size` apart in a loop
function wrapDistance(delta, size) {
    if (!size) return Math.abs(delta);
    return Math.min(modulo(delta, size), modulo(-delta, size));
}

function buildAreas(areaData, levels, worldMap) {
    const names = Object.keys(areaData.areas);
    const areas = Object.entries(areaData.areas).map(([name, area]) => ({
        local_area_name: name,
        display: area.display_name || name,
        p: area.map_label_position || area.position,
        pin: area.pin,
        boxes: area.local_area_boxes ?? [],
    }));
    for (const level of levels) {
        const info = areaData.levels[level.n] || {};
        if (names.includes(info.local_area_name)) {
            level.area = names.indexOf(info.local_area_name);
            // in boxes of several areas: [area index, float_parameter] per box, the save's activated pins pick one
            if (info.overlap) level.overlap = info.overlap.map(([name, priority]) => [names.indexOf(name), priority]);
        } else if (names.includes(info.nearest_local_area_name)) {
            // outside every local_area box, so the game shows no area there; group it with the nearest box
            level.area = names.indexOf(info.nearest_local_area_name);
            level.areaNear = 1;
        }
    }
    // Areas: grouped by layer (name prefix g_/s_/u_), then by distance from that layer's crossroads hub
    const byName = new Map(areas.map((area) => [area.local_area_name, area]));
    for (const area of areas) {
        const prefix = area.local_area_name.split('_')[1].slice(0, 1);
        area.layer = LAYER_OF_PREFIX[prefix] ?? 'ground';
    }
    // the world wraps around at its edges (map.json size)
    const [width, height] = worldMap ? worldMap.size : [null, null];
    const hubDistance = areas.map((area) => {
        const hub = (byName.get(HUBS[area.layer]) ?? area).p;
        const dx = wrapDistance(area.p[0] - hub[0], width);
        const dy = wrapDistance(area.p[1] - hub[1], height);
        return roundTo(Math.sqrt(dx ** 2 + dy ** 2), DISTANCE_PLACES);
    });
    const order = areas.map((_, i) => i);
    order.sort((first, second) => {
        const byLayer = LAYER_RANK.indexOf(areas[first].layer) - LAYER_RANK.indexOf(areas[second].layer);
        if (byLayer) return byLayer;
        return hubDistance[first] - hubDistance[second];
    });
    order.forEach((areaIndex, rank) => {
        areas[areaIndex].order = rank;
    });
    return areas;
}

function buildFogSummary(fog) {
    const summary = {
        grid: fog.grid,
        primary: fog.primary.map((entry) => ({ pid: entry.pid, layer: entry.layer })),
        boxes: fog.boxes
            .filter((box) => !box.only_overhang)
            .map((box) => ({ pid: box.pid, layer: box.layer, min: box.min, max: box.max })),
        levels: new Map(fog.level_entries.map(([name, layer, region]) => [name, [layer, region]])),
    };
    if (fog.start !== undefined) summary.start = fog.start;
    return summary;
}

// Per map layer, the box of its MAIN_MAP Camera_Marker (the overhead map's view of the whole layer): centre, extents
function addMainBoxes(pkg, raw, worldMap) {
    for (const { fields } of packageEntities(pkg, raw, 'Camera_Marker')) {
        if (fields.overhead_map_type !== 'MAIN_MAP') continue;
        const centre = positionOf(fields);
        const z = centre[2];
        const layer = worldMap.layers.find((candidate) => candidate.z[0] <= z && z < candidate.z[1]);
        if (!layer) continue;
        worldMap.main_box ??= {};
        worldMap.main_box[layer.key] = {
            c: centre,
            e: ['x', 'y', 'z'].map((axis) => roundTo(get(fields, `props.box_extents.${axis}`, 0), POSITION_PLACES)),
        };
    }
}

function main() {
    paths.parseCommandLine();
    const levelData = readJson(paths.data('levels.json'));
    const overworld = levelData.levels.find((level) => level.name === 'overworld').entities;
    const areaData = readOptionalJson(paths.data('level_areas.json'));
    const fog = readOptionalJson(paths.data('fog.json'));
    const worldMap = readOptionalJson(paths.data('map.json'));
    const pkg = new Package();
    const raw = pkg.rawEntities('overworld');

    const { levels, index } = buildLevels(overworld);
    const towers = buildTowers(pkg, raw, overworld);
    const fogLayers = fog ? fog.layers.map((layer) => [layer.index, layer.zmin, layer.zmax]) : [];
    const layerOf = (z) => {
        for (const [layerIndex, low, high] of fogLayers) {
            if ((low === null || low <= z) && (high === null || z <= high)) return layerIndex;
        }
        return 0;
    };
    const { freezers, signs, towerIndex } = buildFreezers(overworld, index, towers, fog ? layerOf : null);
    const signRows = buildSignRows(signs, freezers, towerIndex, fog ? layerOf : null);
    const sets = assignSets(levelData, levels);

    const out = {
        levels,
        sets,
        towers,
        freezers,
        signs: signRows,
        endgame_way_ins: buildEndgameWayIns(levels, sets, freezers, signRows, towers),
        treasures: (overworld.Treasure_Display ?? []).length,
    };
    // voice logs (heard once a played change is recorded; `d` when the level data starts them heard) and the map scrolls
    out.voice_logs = (overworld.Voice_Log ?? []).map((log) => {
        const row = { pid: log.pid, p: positionOf(log.fields), name: get(log.fields, 'name', '') };
        if (fog) row.l = layerOf(row.p[2]);
        if (log.fields.author) row.author = log.fields.author;
        if (log.fields.played) row.d = 1;
        return row;
    });
    out.view_givers = packageEntities(pkg, raw, 'View_Giver').map((giver) => {
        const row = { pid: giver.pid, p: positionOf(giver.fields) };
        if (fog) row.l = layerOf(row.p[2]);
        return row;
    });
    if (areaData) out.areas = buildAreas(areaData, levels, worldMap);
    if (fog) out.fog = buildFogSummary(fog);
    if (worldMap) {
        out.map = worldMap;
        addMainBoxes(pkg, raw, worldMap);
    }
    pkg.close();
    const worldPath = paths.data('world.json');
    if (existsSync(worldPath)) {
        const world = readJson(worldPath);
        for (const room of world.gold_rooms) room.tower = towers.findIndex((tower) => tower.pid === room.tower);
        addTowerPads(overworld, towers, world.teleporters);
        Object.assign(out, world);
    }
    const progressPath = paths.data('progress.json');
    writeJsonAtomic(progressPath, out);
    const gated = levels.filter((level) => level.req.length).length;
    console.log(
        `levels ${levels.length} gated ${gated} towers ${towers.length} freezers ${freezers.length} ` +
            `areas ${(out.areas ?? []).length} bytes ${statSync(progressPath).size}`,
    );
}

main();
