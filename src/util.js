// DOM and text helpers: queries, escaping, the save's Apollo times (SAVES.md "Status.sokoban_status (campaign status)"),
// durations, hex dumps and achievement names (PROGRESSION.md "Achievements and ranks")
import { towerWorlds, WORLDS } from './model/towers.js';

export const $ = (selector, root = document) => root.querySelector(selector);
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (text) => String(text).replace(/[&<>"]/g, (character) => HTML_ESCAPES[character]);
const APOLLO_TO_FILETIME = (-630480n << 64n) + 0xae1758526cfc8000n;
const apolloTicks = (lo, hi) => (BigInt(hi) << 64n) | BigInt.asUintN(64, BigInt(lo));
export function apolloDate(lo, hi) {
    const fileTime = (apolloTicks(lo, hi) - APOLLO_TO_FILETIME) / 100000000n;
    return new Date(Number((fileTime - 116444736000000000n) / 10000n));
}
export function apolloSeconds(lo, hi) {
    return Number(apolloTicks(lo, hi) / 1000000000000n) / 1000;
}
// "1h 05m" from an hour on, else "4m 09s"
export function dur(seconds) {
    const total = Math.round(seconds),
        hours = Math.floor(total / 3600),
        minutes = Math.floor(total / 60) % 60,
        rest = total % 60;
    if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}
export function hex(bytes, max = 64) {
    let text = Array.from(bytes.subarray(0, max), (byte) => byte.toString(16).padStart(2, '0')).join(' ');
    if (bytes.length > max) text += ` … (${bytes.length} bytes)`;
    return text;
}
// the game's achievement names; "TOWER_HS_UNDERWORLD" -> "Low HxS", "GOLD_HS" -> "Gold HxS", "TOWER_HS" -> "Antipode HxS"
const ACH_NAMES = {
    HEROES: 'Heroes',
    MIRRORS: 'Mirror Isles',
    SKIPPING: 'Skipping Stones',
    PROMISE: 'Beamcasters',
    ENDGAME1: 'Endgame',
    ENDGAME2: 'Second Endgame',
    ENDGAME3: 'Final Endgame',
};
// the tower bit of an achievement's layer suffix
function layerBit(suffix) {
    if (suffix === 'SKY') return 16;
    if (suffix === 'UNDERWORLD') return 32;
    return 0;
}
// "GOLD_HS" -> "Gold HxS", and the tower achievements by the tower's layer
function towerAchievementName(kind, letters, suffix) {
    const worldBit = (letter) => WORLDS.find((world) => world[1] === letter)[0];
    const tower = [...letters].reduce((bits, letter) => bits | worldBit(letter), 0) | layerBit(suffix);
    const worlds = towerWorlds(tower);
    if (kind === 'GOLD') return `Gold ${worlds}`;
    if (tower & 16) return `High ${worlds}`;
    if (tower & 32) return `Low ${worlds}`;
    return `Antipode ${worlds}`;
}
export function prettyAch(name) {
    if (ACH_NAMES[name]) return ACH_NAMES[name];
    const match = /^(TOWER|GOLD)_([HMSP]{1,4})(?:_(SKY|UNDERWORLD))?$/.exec(name);
    if (match) return towerAchievementName(match[1], match[2], match[3]);
    return (name[0] + name.slice(1).toLowerCase()).replace(/_/g, ' ').replace(/(\D)(\d)/, '$1 $2');
}
// per key keyOf(item), how many of the items have it, in first-seen order
export const countBy = (items, keyOf) => {
    const counts = new Map();
    for (const item of items) {
        const key = keyOf(item);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
};
export const segOn = (button, on) => {
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', on);
};
