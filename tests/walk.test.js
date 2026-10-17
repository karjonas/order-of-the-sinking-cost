// The walk model on save snapshots, read-only: parsing, reachability, level roles and next steps. The save tests run
// only when SOKO_SAVES names a folder of snapshots, so a save that is still being played never decides a test.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { savesDir } from '../scripts/saves.js';
import { PROG, worldReady } from '../src/data.ts';
import { latestOf, parseHistory, parseStatus, protectedHeroes } from '../src/save.ts';
import { walker } from '../src/walk/walker.ts';
import { ROLE } from '../src/model/level-roles.ts';
import { nextSteps } from '../src/model/next-steps.ts';
import { computeProgress, setProgressCache } from '../src/model/progress.ts';

const read = (camp, name) => new Uint8Array(readFileSync(join(savesDir(), camp, name)));
const hasSave = (camp) =>
    Boolean(process.env.SOKO_SAVES) &&
    existsSync(join(savesDir(), camp, 'Status.sokoban_status')) &&
    existsSync(join(savesDir(), camp, 'overworld.history'));

beforeAll(async () => {
    await worldReady;
    setProgressCache(new WeakMap());
});

test('static roles', () => {
    expect(ROLE).toBeTruthy();
    const levelRoles = [...ROLE.need.l];
    expect(levelRoles.length).toBe(PROG.levels.length);
    expect(levelRoles.filter(Boolean).length).toBe(769);
    expect(levelRoles.filter((role) => role === 1).length).toBe(166);
    expect(levelRoles.filter((role) => !role).length).toBe(151);
    expect(ROLE.need.g.length).toBe(PROG.freezers.length);
    expect(ROLE.bg.l.length).toBe(PROG.levels.length);
});

// kept hero positions outside the cells reachability() fills (seeded as it seeds them: a position that lands nowhere
// or in deep water seeds nothing), not counting the dead ones inside a wall no beam runs through nor the ones that land
// nowhere (a hero riding a Lily over deep water)
function heroesOutside(status, history, progress) {
    const latest = latestOf(history),
        levels = PROG.levels;
    const { flood, land, deep, insideWall, cellOf, heroSeed } = walker(
        latest,
        progress.tst,
        progress.gateOpen.map((open) => !open),
    );
    const flags = new Map(status.levels.map((level) => [level.name, level.flags])),
        protectedKeys = protectedHeroes(history, PROG.world.guy || [0, 0]);
    const seeds = [history.hero ? heroSeed(history.hero) : -1];
    for (const position of history.heroes.values()) {
        const cell = land(cellOf(...position), false);
        if (!insideWall(cellOf(...position)) && cell >= 0 && !deep(cell))
            seeds.push(protectedKeys.has(position.join(',')) ? [cell, 1] : cell);
    }
    levels.forEach((level) => {
        if (flags.get(level.n) !== undefined) seeds.push(land(cellOf(...level.p)));
    });
    for (const [pid, x, y, z] of PROG.world.area_pins)
        if (latest.get(pid, 'activated')?.[0] === 1) seeds.push(land(cellOf(x, y, z), false));
    PROG.teleporters.forEach((teleporter, ti) => {
        if (progress.tst[ti].disc) seeds.push(land(cellOf(...teleporter.p)));
    });
    const reached = flood(seeds, null, new Set()),
        isReached = (cell) => reached.has(cell) || reached.has(land(cell));
    return [...history.heroes.values()].filter((position) => {
        const cell = cellOf(...position);
        const landing = land(cell, false);
        return !insideWall(cell) && landing >= 0 && !deep(landing) && !isReached(cell);
    });
}

describe.each([['default', 2]])('save %s', (camp, maxOutside) => {
    const run = hasSave(camp) ? test : test.skip;
    run('parses, walks and lists next steps', () => {
        const status = parseStatus(read(camp, 'Status.sokoban_status')),
            history = parseHistory(read(camp, 'overworld.history'));
        expect(status.levels.length).toBeGreaterThan(0);
        expect(history.actions.length).toBeGreaterThan(0);
        expect(history.hero).toBeTruthy();
        expect(history.heroes.size).toBeGreaterThan(0);
        const progress = computeProgress(status, history),
            levels = PROG.levels;
        expect(progress.reach).toBeTruthy();
        expect(progress.reach.level.length).toBe(levels.length);
        expect(progress.reach.level.some(Boolean)).toBe(true);
        expect(progress.state.length).toBe(levels.length);
        // a level the walk calls unreachable says why, a reachable one does not
        progress.state.forEach((levelState, i) => expect(!!progress.why[i]).toBe(levelState === 'blocked'));
        expect(progress.needed.length).toBe(levels.length);
        expect(nextSteps(progress, status)).toEqual(progress.needed);
        // next steps are levels not solved yet
        expect(progress.needed.some(Boolean)).toBe(true);
        progress.needed.forEach((needed, i) => {
            if (needed) expect(progress.state[i]).not.toBe('solved');
        });
        expect(heroesOutside(status, history, progress).length).toBeLessThanOrEqual(maxOutside);
    });
});
