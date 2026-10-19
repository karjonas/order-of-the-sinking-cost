// Fixtures shared by the tests that build synthetic overworlds and progress
import type { LatestValues } from '../src/save.ts';
import type { Freezer, Position, ProgressLevel, Teleporter } from '../src/types.ts';

/** Per column, the z values or ocean indices. */
export type Columns = Record<number, number[]>;

/** Rows of the world's entity lists a test sets. */
export type Rows = Record<string, unknown[]>;

/** Latest values with nothing read, created, skilled or turned. */
export const NONE: LatestValues = {
    get: () => undefined,
    ocean: [],
    created: new Map(),
    skills: new Map(),
    firstHeadings: new Map(),
};

/** A level with the fields a test leaves out set to ones that point nowhere. */
export const level = (name: string, extra: Partial<ProgressLevel> = {}): ProgressLevel => ({
    n: name,
    p: [0, 0, 0],
    glow: 'green',
    req: [],
    ...extra,
});

export const progressLevel = (extra: Partial<ProgressLevel> = {}): ProgressLevel => level('', extra);

export const freezerAt = (pid: number, p: Position): Freezer => ({ pid, p, l: 0, req: [] });

// an enabled minor pad; `to` is the position of a target that is not a pad
export const padAt = (pid: number, p: Position, target: number, to?: Position): Teleporter => {
    const teleporter: Teleporter = { pid, p, l: 0, major: 0, target, en: 1 };
    if (to) teleporter.to = to;
    return teleporter;
};

// a pad with the fields a test leaves out set to ones that point nowhere
export function pad(fields: Partial<Teleporter> & Pick<Teleporter, 'pid'>): Teleporter {
    return { p: [0, 0, 0], l: 0, major: 0, target: 0, en: 0, ...fields };
}

/** The bytes of a little-endian float32. */
export const f32 = (value: number) => new Uint8Array(new Float32Array([value]).buffer);
