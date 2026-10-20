// The name of the rendered image (src/assets/icons/<name>.avif) that marks a level's entry pad
import type { ProgressLevel } from '../types.ts';

export type LevelIconState = 'locked' | 'available' | 'solved';

type PadPrefix = 'level-' | 'level-tower-';

/** The glow colours of the pads of the levels that can be entered. */
export const GLOW_GROUPS = ['green', 'orange', 'yellow', 'blue', 'purple'] as const;

export type GlowGroup = (typeof GLOW_GROUPS)[number];

export type LevelIconName = `${PadPrefix}locked` | `${PadPrefix}solved` | `${PadPrefix}available-${GlowGroup}`;

/** Every pad icon, plain and tower, in every state and glow group. */
export const LEVEL_ICON_NAMES: LevelIconName[] = [];
for (const prefix of ['level-', 'level-tower-'] as const) {
    LEVEL_ICON_NAMES.push(`${prefix}locked`, `${prefix}solved`);
    for (const group of GLOW_GROUPS) {
        LEVEL_ICON_NAMES.push(`${prefix}available-${group}`);
    }
}

/**
 * The pad icon of a level in a state: the plain or tower shape, and for the available state the glow colour of the
 * level's group. The locked and solved pads have no hue.
 */
export function levelIconName(level: Pick<ProgressLevel, 'glow' | 'tower'>, state: LevelIconState): LevelIconName {
    let prefix: PadPrefix = 'level-';
    if (level.tower) prefix = 'level-tower-';
    if (state === 'locked' || state === 'solved') return `${prefix}${state}`;
    return `${prefix}${state}-${level.glow}`;
}
