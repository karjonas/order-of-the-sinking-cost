// Access to decoded entity fields (objects keyed by field name) with a fallback for a field the blob does not hold
import type { Vector } from './math.ts';

export type Fields = Record<string, unknown>;

// The field's value as decoded, else the fallback. The type of the fallback names the type the field holds; without a
// fallback the value is unchecked and undefined for a field the blob does not hold.
export function get(fields: Fields, key: string, fallback: number): number;
export function get(fields: Fields, key: string, fallback: string): string;
export function get(fields: Fields, key: string, fallback: boolean): boolean;
export function get(fields: Fields, key: string): unknown;
export function get(fields: Fields, key: string, fallback?: unknown): unknown {
    if (key in fields) return fields[key];
    return fallback;
}

// The x, y and z fields under a prefix (such as `base.scale`), each with its own fallback
export function vectorOf(fields: Fields, prefix: string, fallback: Vector = [0, 0, 0]): Vector {
    return [
        get(fields, `${prefix}.x`, fallback[0]),
        get(fields, `${prefix}.y`, fallback[1]),
        get(fields, `${prefix}.z`, fallback[2]),
    ];
}

// The entity's world position
export function positionOf(fields: Fields): Vector {
    return vectorOf(fields, 'base.position');
}

// A number field that is always present, such as one of an entity decoded with its type defaults
export function requireNumber(fields: Fields, key: string): number {
    const value = fields[key];
    if (typeof value !== 'number') throw new Error(`field ${key} is not a number`);
    return value;
}

// The entity id an id field names: the pid inside an [id text, pid] pair, 0 for none
export function refOf(value: unknown): number {
    if (Array.isArray(value)) return value[1];
    if (typeof value === 'number') return value || 0;
    return 0;
}

// A field's list of enum flag names (empty when the field is missing or holds no flags)
export function flagsOf(fields: Fields, key: string): string[] {
    const value = fields[key];
    if (Array.isArray(value)) return value;
    return [];
}
