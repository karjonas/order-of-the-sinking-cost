// The shapes of the data files the build scripts write into data/ and read back, so a producer and its readers agree.
// The viewer's own files (progress.json, world.json) are typed in src/types.ts.
import type { AreaBox, Position, ProgressFog, ProgressMap } from '../../src/types.ts';
import type { Fields } from './fields.ts';

// An entity as data/levels.json lists it
export interface PlacedEntity {
    id: string;
    pid: number;
    fields: Fields;
}

// One level of data/levels.json: its entities of the progression types, by type name
export interface LevelEntry {
    name: string;
    level_sets: string[];
    entity_count: number;
    namespaces: [namespace: number, count: number][];
    type_counts: Record<string, number>;
    settings: Fields;
    entities: Record<string, PlacedEntity[] | undefined>;
}

// data/levels.json
export interface LevelsFile {
    level_sets: Record<string, string[]>;
    levels: LevelEntry[];
}

// data/level_entities/<level>.json: every entity of the level as a row of `columns`, with its type and mesh as indices
// into `types` and `meshes`
export interface LevelEntitiesFile {
    level: string;
    columns: string[];
    types: string[];
    meshes: string[];
    ents: [pid: number, type: number, x: number, y: number, z: number, mesh: number][];
}

// What data/level_areas.json holds of one Area_Pin
export interface AreaRecord {
    pin: number;
    pin_id: string;
    local_area_name: string;
    display_name: string | null;
    local_area_image: string;
    position: Position;
    map_label_marker: number | null;
    map_label_position: Position | null;
    local_area_markers: number[];
    local_area_boxes: AreaBox[];
    level_count: number;
    level_count_with_fallback: number;
}

// What data/level_areas.json holds of one Level_Entry: the area its cell lies in, or else the nearest one
export interface EntryRecord {
    entry: string;
    position: Position;
    area_pin?: number | null;
    local_area_name?: string | null;
    display_name?: string | null;
    exact?: boolean;
    marker?: number;
    candidates?: number;
    overlap?: [areaName: string, priority: number][];
    nearest_area_pin?: number;
    nearest_local_area_name?: string;
    nearest_display_name?: string | null;
    nearest_marker?: number;
    margin?: number;
}

// data/level_areas.json
export interface LevelAreasFile {
    rule: string;
    areas: Record<string, AreaRecord>;
    levels: Record<string, EntryRecord | undefined>;
    unassigned: string[];
}

// A primary Fog_Of_War: the fog of one ground layer, with the vertical reach it overrides per region
export interface FogPrimary {
    pid: number;
    id: string;
    name: string;
    layer: number;
    z: number;
    zmin: number | null;
    zmax: number | null;
    z_overrides: [region: number, zmin: number | null, zmax: number | null, id: string][];
}

// A non-primary Fog_Of_War: a box with a single region state
export interface FogBox {
    pid: number;
    id: string;
    name: string;
    layer: number;
    min: Position;
    max: Position;
    regions: number;
    only_overhang: boolean;
}

// A Fog_Of_War_Clear: clears the region it stands in, and the neighbouring one in `dir`
export interface FogClear {
    id: string;
    layer: number;
    region: number;
    dir: string;
    to: number;
    radius: number | null;
}

// data/fog.json
export interface FogFile {
    level: string;
    grid: ProgressFog['grid'];
    layers: { index: number; name: string; zmin: number | null; zmax: number | null }[];
    states: Record<number, string>;
    primary: FogPrimary[];
    boxes: FogBox[];
    clears: FogClear[];
    level_entries: [level: string, layer: number, region: number][];
    area_pins: [id: string, name: string, layer: number, region: number][];
    start: ProgressFog['start'];
}

// data/map.json
export type MapFile = Pick<ProgressMap, 'corner' | 'size' | 'layers' | 'oceans'>;
