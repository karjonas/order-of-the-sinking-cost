// A level whose gate waits on a level the walk reaches it from has a way in when that level has a way in of its own
import { beforeAll, expect, test } from 'vitest';
import { freshCampaign, walkLoaded } from '../scripts/lib/walk-fingerprint.ts';
import { PROG } from '../src/data.ts';
import { computeProgress } from '../src/model/progress.ts';
import type { CampaignProgress } from '../src/model/progress.ts';

let progress: CampaignProgress;

function levelIndex(name: string): number {
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
    expect(progress.wayIn[preceding]!.length).toBeGreaterThan(0);
    expect(progress.wayIn[level]!.length).toBeGreaterThan(0);
});

test('levels whose gates wait on each other in one pocket keep no way in', () => {
    for (const name of ['invisible_hand', 'wizard_finesse_1', 'be_aggro_alt_2']) {
        const index = levelIndex(name);
        expect(progress.state[index]).toBe('blocked');
        expect(progress.wayIn[index]).toEqual([]);
    }
});

test('a level a swap onto a stone on a frozen Lily leads to has the Lily Freezers and the stone Freezer as its way in', () => {
    const lilyFreezerPids = [135519641, 90187135, 90187141];
    const level = levelIndex('wizard_with_a_capital_w_2_v2');
    const wayInPids = progress.wayIn[level]!.map((freezerIndex) => PROG.freezers[freezerIndex].pid);

    expect(progress.state[level]).toBe('blocked');
    expect(wayInPids.toSorted()).toEqual(lilyFreezerPids.toSorted());
});
