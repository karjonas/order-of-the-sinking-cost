// Towers: their worlds, layers, names and progress (PROGRESSION.md "Tower")
import { PROG } from '../data.js';

// bit, save enum letter, name, letter in tower pair names, name in the sky tower achievements
export const WORLDS = [
    [1, 'H', 'Heroes', 'H', 'Heroes'],
    [2, 'M', 'Mirror Isles', 'M', 'Mirrors'],
    [4, 'S', 'Skipping Stones', 'S', 'Skipping Stones'],
    [8, 'P', 'Beamcasters', 'B', 'Beamcasters'],
];
// a pair reads "HxM" and a single world (the sky towers) by its name
export const towerWorlds = (towerBits) => {
    const worlds = WORLDS.filter(([b]) => towerBits & b);
    return worlds.length === 1 ? worlds[0][4] : worlds.map(([, , , l]) => l).join('x');
};
// bit 16: a sky tower, bit 32: an underworld tower
export function towerName(towerBits) {
    const worlds = towerWorlds(towerBits);
    if (towerBits & 16) return `High ${worlds} tower`;
    if (towerBits & 32) return `Low ${worlds} tower`;
    return `${worlds} tower`;
}
function towerAchievementSuffix(towerBits) {
    if (towerBits & 16) return '_SKY';
    if (towerBits & 32) return '_UNDERWORLD';
    return '';
}
export function towerAchievement(towerBits) {
    const letters = WORLDS.filter(([b]) => towerBits & b)
        .map(([, l]) => l)
        .join('');
    return 'TOWER_' + letters + towerAchievementSuffix(towerBits);
}
// Per tower: its normal and dropdown levels, how many normal ones are solved, active (enough of them solved) and gold
// (every dropdown solved)
export function towerProgress(solved) {
    const levels = PROG.levels;
    return PROG.towers.map((t) => {
        const mem = levels.map((l, i) => i).filter((i) => levels[i].t === t.t);
        const normal = mem.filter((i) => !levels[i].d),
            drop = mem.filter((i) => levels[i].d);
        const sn = normal.filter(solved).length,
            sd = drop.filter(solved).length;
        return { ...t, normal, drop, solvedNormal: sn, active: sn >= t.req, gold: sd === drop.length };
    });
}
