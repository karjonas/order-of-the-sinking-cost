// The area emblems and tower badges: the names of the rendered images (src/assets/icons/area-<emblem>.avif and
// tower-<worlds>[-gold].avif) of an area and of a tower
import type { Area } from '../types.ts';

export type EmblemIconName =
    | 'area-soko'
    | 'area-mirror'
    | 'area-skipping'
    | 'area-prom'
    | 'area-soko-mirror'
    | 'area-soko-skipping'
    | 'area-soko-prom'
    | 'area-skipping-mirror'
    | 'area-prom-mirror'
    | 'area-skipping-prom';

/** Every emblem image: one per world and one per pair of worlds. */
export const EMBLEM_ICON_NAMES: EmblemIconName[] = [
    'area-soko',
    'area-mirror',
    'area-skipping',
    'area-prom',
    'area-soko-mirror',
    'area-soko-skipping',
    'area-soko-prom',
    'area-skipping-mirror',
    'area-prom-mirror',
    'area-skipping-prom',
];

type TowerLetters = 'h' | 'm' | 's' | 'p' | 'hm' | 'hs' | 'hp' | 'ms' | 'mp' | 'sp';

export type TowerBadgeName = `tower-${TowerLetters}` | `tower-${TowerLetters}-gold`;

const WORLD_BITS_MASK = 15;

/**
 * The letters of a tower's badge by its worlds' bits (Heroes 1, Mirror Isles 2, Skipping Stones 4, Beamcasters 8): h, m,
 * s and p for a single world and the pair's letters in the fixed order of the game's textures.
 */
const WORLD_LETTERS: Record<number, TowerLetters> = {
    1: 'h',
    2: 'm',
    4: 's',
    8: 'p',
    3: 'hm',
    5: 'hs',
    9: 'hp',
    6: 'ms',
    10: 'mp',
    12: 'sp',
};

/** Every tower badge image: one per world and one per pair of worlds, plain and gold. */
export const TOWER_BADGE_NAMES: TowerBadgeName[] = [];
for (const letters of Object.values(WORLD_LETTERS)) {
    TOWER_BADGE_NAMES.push(`tower-${letters}`, `tower-${letters}-gold`);
}

/** The badge of a tower with one or two worlds, the gold one once its dropdowns are solved; null for a tower with more. */
export function towerBadgeName(towerBits: number, gold: boolean): TowerBadgeName | null {
    const letters = WORLD_LETTERS[towerBits & WORLD_BITS_MASK];
    if (!letters) return null;
    if (gold) return `tower-${letters}-gold`;
    return `tower-${letters}`;
}

/** The gold badge of a pair's gold achievement (`GOLD_HM`, the worlds in the save's letters); null for any other name. */
export function goldBadgeName(achievement: string): TowerBadgeName | null {
    const match = /^GOLD_([HMSP]{2})$/.exec(achievement);
    if (!match) return null;
    const letters = match[1].toLowerCase();
    return TOWER_BADGE_NAMES.find((badge) => badge === `tower-${letters}-gold`) ?? null;
}

/** The emblem of an area from its texture name (`OverworldIcon_Soko_Prom`); null for an area with none. */
export function areaEmblemName(area: Pick<Area, 'image'>): EmblemIconName | null {
    const name = area.image
        .replace(/^OverworldIcon_/, 'area-')
        .toLowerCase()
        .replaceAll('_', '-');
    return EMBLEM_ICON_NAMES.find((emblem) => emblem === name) ?? null;
}
