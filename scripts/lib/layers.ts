// The overworld's ground layers (on the ground, under it, in the sky and the three fast-travel map rooms) as the game
// builds them from the level Settings and the FAST_TRAVEL Camera_Markers
import { get, refOf, type Fields } from './fields.ts';

// The z extent of a layer: [min z, max z]
export type LayerRange = [min: number, max: number];

export interface LayerSettings {
    hasLower: boolean;
    hasUpper: boolean;
    undergroundBarrier: number;
    skygroundBarrier: number;
}

export interface FastTravelBox {
    z: number;
    extent: number;
}

export const LAYER_NAMES = [
    'ONGROUND',
    'UNDERGROUND',
    'SKYGROUND',
    'FAST_TRAVEL_UNDERGROUND',
    'FAST_TRAVEL_ONGROUND',
    'FAST_TRAVEL_SKYGROUND',
];
// The layer a Group binds its members to (Group.bind_to_layer)
export const GROUP_LAYER: Record<string, number | undefined> = {
    GROUND: 0,
    SKY: 2,
    UNDERWORLD: 1,
    FAST_TRAVEL_GROUND: 4,
    FAST_TRAVEL_SKY: 5,
    FAST_TRAVEL_UNDERWORLD: 3,
};

const MAX_GROUP_DEPTH = 16;

// The layer the nearest Group in an entity's Group chain binds it to, or null when the chain binds none
export function boundLayer(groups: Map<number, Fields>, fields: Fields): number | null {
    let group = refOf(fields['base.group_id']);
    let depth = 0;
    while (group && depth < MAX_GROUP_DEPTH) {
        const groupFields = groups.get(group);
        if (groupFields === undefined) return null;
        const bind = groupFields.bind_to_layer;
        if (typeof bind === 'string' && bind !== '' && bind !== 'NONE') return GROUP_LAYER[bind] ?? null;
        group = refOf(groupFields['base.group_id']);
        depth++;
    }
    return null;
}

// [{ z, extent }] of the FAST_TRAVEL Camera_Markers: their centre z and half height
export function fastTravelBoxes(cameraMarkers: Fields[]): FastTravelBox[] {
    return cameraMarkers
        .filter((fields) => fields.overhead_map_type === 'FAST_TRAVEL')
        .map((fields) => ({
            z: get(fields, 'base.position.z', 0),
            extent: get(fields, 'props.box_extents.z', 0),
        }));
}

// The layer settings the table needs, with defaults for a missing field
export function layerSettings(settings: Fields): LayerSettings {
    return {
        hasLower: Boolean(settings.has_lower_layer ?? false),
        hasUpper: Boolean(settings.has_upper_layer ?? false),
        undergroundBarrier: get(settings, 'underground_barrier', 0),
        skygroundBarrier: get(settings, 'skyground_barrier', 0),
    };
}

// [min z, max z] per layer index, null for a layer the level does not have
export function layerTable(settings: LayerSettings, fastTravel: FastTravelBox[]): (LayerRange | null)[] {
    const table: (LayerRange | null)[] = Array(6).fill(null);
    const lower = settings.hasLower ? settings.undergroundBarrier : -Infinity;
    const upper = settings.hasUpper ? settings.skygroundBarrier - 0.001 : Infinity;
    table[0] = [lower, upper];
    if (settings.hasLower) table[1] = [-Infinity, settings.undergroundBarrier - 0.001];
    if (settings.hasUpper) table[2] = [settings.skygroundBarrier, Infinity];
    const boxes = fastTravel.toSorted((first, second) => first.z - second.z);
    if (boxes.length === 3) {
        const topLayer = table[2] ? 2 : 0;
        boxes.forEach((box, i) => {
            const bottom = box.z - box.extent;
            const top = box.z + box.extent;
            let min = bottom;
            if (i === 0) {
                table[topLayer]![1] = bottom - 0.001;
            } else {
                min = table[i + 2]![1] + 0.001;
            }
            table[i + 3] = [min, i === 2 ? Infinity : top];
        });
    }
    return table;
}

// The layer index a z belongs to: the group's own layer when it has one, else the layer whose range holds z, else the
// closest layer below it
export function groundLayer(table: (LayerRange | null)[], z: number, groupLayer: number | null = null): number {
    if (groupLayer !== null && groupLayer !== undefined) return groupLayer;
    const present: [number, LayerRange][] = [];
    table.forEach((range, index) => {
        if (range) present.push([index, range]);
    });
    for (const [index, [min, max]] of present) {
        if (min <= z && z <= max) return index;
    }
    let best = 1;
    let bestDistance = Infinity;
    for (const [index, [min]] of present) {
        const distance = z - min;
        if (distance >= 0 && distance < bestDistance) {
            best = index;
            bestDistance = distance;
        }
    }
    return best;
}
