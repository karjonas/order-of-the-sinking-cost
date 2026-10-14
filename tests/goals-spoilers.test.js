// With spoilers hidden, no goal names or counts anything under fog: the demo ("Example: a new game") and the live
// default save, read-only
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { savesDir } from '../scripts/saves.js';
import { PROG, worldReady } from '../src/data.js';
import { parseHistory, parseStatus } from '../src/save.js';
import { setProgressCache } from '../src/model/progress.js';
import { towerName } from '../src/model/towers.js';
import { setSpoilersHidden, state } from '../src/shared.js';
import { showDemo } from '../src/files.js';
import { progressModel } from '../src/model/progress-model.js';
import { prettyAch } from '../src/util.js';

// the page, without its DOM
vi.mock('../src/view.js', () => ({ show() {} }));
// layer keys stand for their names
vi.mock('../src/model/layers.js', async (importOriginal) => ({ ...(await importOriginal()), layerName: (key) => key }));

const DEMO = 'No save loaded',
    LIVE = 'default';
const hasSave = (camp) =>
    existsSync(join(savesDir(), camp, 'Status.sokoban_status')) &&
    existsSync(join(savesDir(), camp, 'overworld.history'));

beforeAll(async () => {
    await worldReady;
    setProgressCache(new WeakMap());
    await showDemo();
    if (!hasSave(LIVE)) return;
    const read = (name) => new Uint8Array(readFileSync(join(savesDir(), LIVE, name)));
    state.files.set(`${LIVE}/Status.sokoban_status`, {
        path: `${LIVE}/Status.sokoban_status`,
        parsed: parseStatus(read('Status.sokoban_status')),
        error: null,
    });
    state.files.set(`${LIVE}/overworld.history`, {
        path: `${LIVE}/overworld.history`,
        parsed: parseHistory(read('overworld.history')),
        error: null,
    });
});

// every goal text the page may show: labels and what each listed level leads to
function goalTexts(model) {
    const goals = model.goals.flatMap((goal) => [goal, ...(goal.children || [])]);
    return goals.flatMap((goal) => [goal.label, ...model.goalLevels(goal).map((entry) => entry.leadsTo)]);
}
function checkHidden(model) {
    const { progress, levels } = model;
    const texts = goalTexts(model).join('\n');
    const words = new Set(texts.split(/[^\w]+/));
    for (const [i, level] of levels.entries()) if (progress.hidden[i]) expect(words.has(level.n), level.n).toBe(false);
    for (const [ti, tower] of progress.towers.entries())
        if (progress.towerHidden[ti]) expect(texts).not.toContain(towerName(tower.t));
    for (const ending of model.endings) if (!ending.shown) expect(texts).not.toContain(prettyAch(ending.name));
    // the levels listed are not under fog
    for (const goal of model.goals)
        for (const entry of model.goalLevels(goal)) expect(progress.hidden[entry.i]).toBe(false);
    // the towers and the achievements count only the ones not under fog
    const towers = goalOfKind(model, 'towers');
    const achievements = goalOfKind(model, 'achievements');
    expect(towers.progress[1]).toBe(progress.towers.filter((tower, ti) => !progress.towerHidden[ti]).length);
    expect(achievements.progress[1]).toBe(achievements.children.length);
    for (const child of achievements.children) expect(model.achievementHidden(child.name)).toBe(false);
    // Completionist counts the levels not under fog
    expect(goalOfKind(model, 'completionist').progress[1]).toBe(
        levels.filter((level, i) => !progress.hidden[i]).length,
    );
}
const goalOfKind = (model, kind) => model.goals.find((goal) => goal.kind === kind);
const endingLabels = (model) => model.goals.filter((goal) => goal.kind === 'ending').map((goal) => goal.label);

describe('goals with spoilers hidden', () => {
    test('the demo names and counts nothing under fog', () => {
        setSpoilersHidden(true);
        const model = progressModel(DEMO);
        expect(model.progress.hidden.filter(Boolean).length).toBeGreaterThan(0);
        // only the next ending, by its public name
        expect(endingLabels(model)).toEqual(['Endgame']);
        expect(model.achievementHidden('ENDGAME2')).toBe(true);
        checkHidden(model);
    });
    test.skipIf(!hasSave(LIVE))('the live save names and counts nothing under fog', () => {
        setSpoilersHidden(true);
        const model = progressModel(LIVE);
        checkHidden(model);
        expect(model.goals.filter((goal) => goal.active).length).toBeLessThanOrEqual(1);
    });
    test('with spoilers shown every ending is listed by its Steam name', () => {
        setSpoilersHidden(false);
        const model = progressModel(DEMO);
        expect(endingLabels(model)).toEqual(['Endgame', 'Second Endgame', 'Final Endgame']);
        expect(PROG.levels.length).toBe(goalOfKind(model, 'completionist').progress[1]);
        setSpoilersHidden(true);
    });
});
