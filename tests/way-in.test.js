// A level whose gate waits on a level the walk reaches it from has a way in when that level has a way in of its own
import { beforeAll, expect, test } from 'vitest';
import { freshCampaign, walkLoaded } from '../scripts/lib/walk-fingerprint.js';
import { PROG } from '../src/data.ts';
import { computeProgress } from '../src/model/progress.ts';

let progress = null;

function levelIndex(name) {
    const index = PROG.levels.findIndex((level) => level.n === name);
    if (index < 0) throw new Error(`no level ${name}`);
    return index;
}

beforeAll(async () => {
    await walkLoaded();
    const { status, history } = freshCampaign();
    progress = computeProgress(status, history);
});

test('a level its gate waits on a level with a way in for, from which the walk reaches it, has a way in', () => {
    const level = levelIndex('torcoban_2');
    const preceding = levelIndex('green_revolution');

    expect(progress.state[level]).toBe('blocked');
    expect(progress.wayIn[preceding].length).toBeGreaterThan(0);
    expect(progress.wayIn[level].length).toBeGreaterThan(0);
});

test('levels whose gates wait on each other in one pocket keep no way in', () => {
    for (const name of ['invisible_hand', 'wizard_finesse_1', 'be_aggro_alt_2']) {
        const index = levelIndex(name);
        expect(progress.state[index]).toBe('blocked');
        expect(progress.wayIn[index]).toEqual([]);
    }
});
