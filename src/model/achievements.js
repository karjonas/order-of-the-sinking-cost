// Achievements, the endings and the rank markers (PROGRESSION.md "Achievements and ranks", "Endings")
import { PROG, SCHEMA } from '../data.js';
import { towerAchievement } from './towers.js';

// the rank each ending's achievement gives
export const ENDINGS = [
    [1, 'ENDGAME1'],
    [3, 'ENDGAME2'],
    [5, 'ENDGAME3'],
];
// the grant_rank markers: achievement, rank, the layer they stand on
export const MARKER_RANKS = [
    ['ASCEND', 2, 'sky'],
    ['DESCEND', 4, 'underworld'],
];

export function hasAchievement(status, name) {
    const v = SCHEMA.enums.Achievement?.values.find(([n]) => n === name)?.[1];
    return v != null && ((BigInt.asUintN(64, status.achievements) >> BigInt(v)) & 1n) === 1n;
}

export function achievementRules(progress) {
    const L = PROG.levels,
        out = new Map();
    L.forEach((l, i) => {
        if (l.a) out.set(l.a, { text: '', levels: [i] });
    });
    for (const t of progress.towers) out.set(towerAchievement(t.t), { text: 'Required levels solved', tower: t });
    out.set('ASCEND', { text: 'Rank Pusher', layer: 'sky' });
    out.set('DESCEND', { text: 'Rank Intrepid', layer: 'underworld' });
    out.set('COMPLETIONIST', { text: 'All levels' });
    return out;
}

// the game's achievements in value order (value 0 is none)
export function achievementNames() {
    return (SCHEMA.enums.Achievement?.values || []).filter(([, value]) => value > 0).map(([name]) => name);
}
