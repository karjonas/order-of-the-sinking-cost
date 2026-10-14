// Dumps the game's level package: data/levels.json (progression entities and settings of every level) and
// data/level_entities/<level>.json (every entity's position, for the editor-style views).
//
// Reads <game>/data/levels.package and data/schema.json.
//
// Usage: node scripts/build-levels.js [--game DIR] [--types-json FILE]
// With --types-json, only writes the [name, version] list of entity types in the package (input for the schema
// exporter, docs/GAMEDATA.md "Reading the schema out of the binary").
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { roundTo } from './lib/math.js';
import { writeJsonAtomic } from './lib/output.js';
import { Package, entityTypes, pidString } from './lib/package.js';
import * as paths from './lib/paths.js';

const PROGRESSION_TYPES = [
    'Level_Entry',
    'Level_Connector',
    'Overworld_Unlock',
    'Area_Pin',
    'Gem_Slot',
    'Treasure',
    'Treasure_Display',
    'Level_State',
    'Checkpoint',
    'Teleporter',
    'Artifact',
    'Voice_Log',
    'Marker',
    'Switch',
    'Freezer',
    'Tower',
    'Sign',
    'Door',
    'Settings',
];
const SETTINGS_SUMMARY = [
    'grid.squares_x',
    'grid.squares_y',
    'grid.num_squares',
    'grid.wrapping',
    'grid.corner.x',
    'grid.corner.y',
    'grid.corner.z',
    'squares_z',
    'story_tag',
    'special_level',
    'fast_travel_corner.x',
    'fast_travel_corner.y',
    'fast_travel_extents.x',
    'fast_travel_extents.y',
    'level_data_version',
    'designers',
    'intro_cutscene',
    'outro_cutscene',
    'story_proc',
    'story_proc_arg_string',
    'story_proc_arg_int',
    'sound_level_name',
];
// The base fields worth keeping on a progression entity
const KEPT_BASE_FIELDS = new Set([
    'base.position.x',
    'base.position.y',
    'base.position.z',
    'base.orientation.z',
    'base.orientation.w',
    'base.entity_flags',
    'base.entity_name',
    'base.group_id',
    'base.mesh',
]);
const POSITION_PLACES = 3;
const FIELD_PLACES = 4;

// A decoded value with its floats rounded to four places
function roundFloats(value) {
    if (Array.isArray(value)) return value.map(roundFloats);
    if (typeof value === 'number' && !Number.isInteger(value)) return roundTo(value, FIELD_PLACES);
    return value;
}

// Counts keyed by value, in first-seen order
function countOf(values) {
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
}

// The [value, count] pairs with the highest counts, equal counts in first-seen order
function mostCommon(counts, limit) {
    return [...counts.entries()].toSorted((first, second) => second[1] - first[1]).slice(0, limit);
}

function levelsInSets(sets) {
    const inSets = new Map();
    for (const [setName, members] of sets) {
        for (const level of members) {
            if (!inSets.has(level)) inSets.set(level, []);
            inSets.get(level).push(setName);
        }
    }
    return inSets;
}

function positionsFile(level, { typeNames, meshes, entities }) {
    const rows = entities.map(([pid, type, x, y, z, mesh]) => {
        const coordinates = [x, y, z].map((value) => roundTo(value, POSITION_PLACES));
        return [pid, type, ...coordinates, mesh];
    });
    return {
        level,
        columns: ['pid', 'type', 'x', 'y', 'z', 'mesh'],
        types: typeNames,
        meshes,
        ents: rows,
    };
}

// The progression entities and Settings of one level. Settings come back as the level's values (and every default
// seen goes into `settingsDefaults`); the other entities are grouped by type.
function progressionOf(pkg, level, settingsDefaults) {
    const { header, records } = pkg.rawEntities(level);
    const settings = new Map();
    const entitiesByType = new Map();
    for (const { pid, type, blob } of records) {
        const [typeName, typeVersion] = header.types[type];
        if (!PROGRESSION_TYPES.includes(typeName)) continue;
        const fields = pkg.decode(blob, typeName, typeVersion, header.base, { withOld: true });
        if (typeName === 'Settings') {
            for (const [key, [oldValue, newValue]] of Object.entries(fields)) {
                if (!settingsDefaults.has(key)) settingsDefaults.set(key, oldValue);
                settings.set(key, newValue);
            }
            continue;
        }
        const kept = {};
        for (const [key, [, newValue]] of Object.entries(fields)) {
            if (key.startsWith('base.') && !KEPT_BASE_FIELDS.has(key)) continue;
            kept[key] = roundFloats(newValue);
        }
        if (!entitiesByType.has(typeName)) entitiesByType.set(typeName, []);
        entitiesByType.get(typeName).push({ id: pidString(pid), pid, fields: kept });
    }
    return { header, records, settings, entitiesByType };
}

function levelSummary(level, inSets, found) {
    const { header, records, settings, entitiesByType } = found;
    const namespaces = countOf(records.map((record) => record.pid >>> 20));
    const typeCounts = countOf(records.map((record) => header.types[record.type][0]));
    const progressionCounts = {};
    for (const typeName of PROGRESSION_TYPES) {
        if (typeCounts.get(typeName)) progressionCounts[typeName] = typeCounts.get(typeName);
    }
    return {
        name: level,
        level_sets: inSets.get(level) ?? [],
        entity_count: records.length,
        namespaces: mostCommon(namespaces, 6),
        type_counts: progressionCounts,
        settings,
        entities: entitiesByType,
    };
}

// The settings every summary lists, a level's own value or else the default of the type
function settingsSummary(settings, settingsDefaults) {
    const summary = {};
    for (const key of SETTINGS_SUMMARY) {
        let value = null;
        if (settings.has(key)) value = settings.get(key);
        else if (settingsDefaults.has(key)) value = settingsDefaults.get(key);
        summary[key] = roundFloats(value);
    }
    return summary;
}

function buildLevels() {
    const pkg = new Package();
    const outputFolder = paths.data('level_entities');
    mkdirSync(outputFolder, { recursive: true });
    const sets = pkg.levelSets();
    const inSets = levelsInSets(sets);
    const settingsDefaults = new Map();
    const levels = [];
    for (const level of pkg.levels()) {
        const found = progressionOf(pkg, level, settingsDefaults);
        levels.push(levelSummary(level, inSets, found));
        writeJsonAtomic(join(outputFolder, level + '.json'), positionsFile(level, pkg.positions(level)));
    }
    for (const field of pkg.schema.types.Settings.fields) {
        if ((field.k === 's' || field.k === 'r') && !settingsDefaults.has(field.n)) settingsDefaults.set(field.n, '');
    }
    for (const level of levels) level.settings = settingsSummary(level.settings, settingsDefaults);
    writeJsonAtomic(paths.data('levels.json'), { level_sets: sets, levels }, { indent: 1 });
    const entityCount = levels.reduce((total, level) => total + level.entity_count, 0);
    console.log('levels', levels.length, 'entities', entityCount);
    pkg.close();
}

function main() {
    const { values } = paths.parseCommandLine({ 'types-json': { type: 'string' } });
    if (!values['types-json']) {
        buildLevels();
        return;
    }
    const pkg = new Package();
    writeJsonAtomic(values['types-json'], entityTypes(pkg));
    pkg.close();
}

main();
