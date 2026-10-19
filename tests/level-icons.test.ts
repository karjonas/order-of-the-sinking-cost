// The level pad icon names: one per shape, state and glow group, each an image that the icon build writes
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { LEVEL_ICON_NAMES, levelIconName } from '../src/map/level-icons.ts';
import type { LevelIconState } from '../src/map/level-icons.ts';
import type { Progress } from '../src/types.ts';

const STATES: LevelIconState[] = ['locked', 'available', 'solved'];
const AVAILABLE_PREFIX = 'level-available-';
const GROUPS = LEVEL_ICON_NAMES.filter((name) => name.startsWith(AVAILABLE_PREFIX)).map((name) =>
    name.slice(AVAILABLE_PREFIX.length),
);
const progress: Progress = JSON.parse(readFileSync(new URL('../data/progress.json', import.meta.url), 'utf8'));

describe('levelIconName', () => {
    test('names the plain and tower pads by state and glow group', () => {
        expect(levelIconName({ glow: 'blue' }, 'available')).toBe('level-available-blue');
        expect(levelIconName({ glow: 'blue', tower: 1 }, 'available')).toBe('level-tower-available-blue');
        expect(levelIconName({ glow: 'purple', tower: 1 }, 'available')).toBe('level-tower-available-purple');
    });

    test('leaves the group out of the locked and solved pads', () => {
        expect(levelIconName({ glow: 'green' }, 'locked')).toBe('level-locked');
        expect(levelIconName({ glow: 'green' }, 'solved')).toBe('level-solved');
        expect(levelIconName({ glow: 'green', tower: 1 }, 'locked')).toBe('level-tower-locked');
        expect(levelIconName({ glow: 'green', tower: 1 }, 'solved')).toBe('level-tower-solved');
    });

    test('every level has a group, every icon it can ask for is listed, and every listed icon exists', () => {
        for (const level of progress.levels) {
            expect(GROUPS).toContain(level.glow);
            for (const state of STATES) expect(LEVEL_ICON_NAMES).toContain(levelIconName(level, state));
        }
        for (const name of LEVEL_ICON_NAMES) {
            const path = new URL(`../public/assets/icons/${name}.avif`, import.meta.url);
            expect(existsSync(path), name).toBe(true);
        }
    });

    test('every group is used by some level', () => {
        const used = new Set<string>(progress.levels.map((level) => level.glow));
        for (const group of GROUPS) {
            expect(used.has(group), group).toBe(true);
        }
    });
});
