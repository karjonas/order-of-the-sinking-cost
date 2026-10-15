// The empty save the page shows before any save is loaded: no progress, and the fog and hero of a new campaign walked
// everywhere it can reach (fog.start, from scripts/build-fog.js). It imports nothing of the page, so scripts and tests
// can build it.
import { PROG } from './data.ts';
import type { History } from './history-file.ts';
import type { DemoStatus } from './status-file.ts';

/** The status of the empty save. */
export const DEMO_STATUS: DemoStatus = {
    version: 33,
    rank: 0,
    achievements: 0n,
    treasureFlags: 0,
    artifacts: 0n,
    levels: [],
    openedFreezers: [],
};

// region states with the given regions cleared (state 2)
function clearedRegions(size: number, regions: number[]): Uint8Array {
    const states = new Uint8Array(size);
    for (const region of regions) {
        if (region < states.length) states[region] = 2;
    }

    return states;
}

/**
 * The history of the empty save, marked `demo`, which the progress model does not walk. Clear the flag to walk a new
 * campaign from its start position.
 */
export function demoHistory(): History {
    const history: History = {
        version: 0,
        types: [],
        actions: [],
        hero: null,
        heroKey: -1,
        fogStates: new Map(),
        demo: true,
    };

    const fog = PROG.fog;
    if (!fog) return history;

    const [columns, rows] = fog.grid.count;
    const sizeOf = (pid: number) => (fog.primary.some((primary) => primary.pid === pid) ? columns * rows : 1);
    history.hero = fog.start.hero;
    history.pinsOn = fog.start.pins;

    for (const [pid, regions] of Object.entries(fog.start.regions)) {
        history.fogStates!.set(+pid, clearedRegions(sizeOf(+pid), regions));
    }

    return history;
}
