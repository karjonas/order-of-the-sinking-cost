// Level_Entry unlocking: which levels and ice gates are open, and what waits on a level
// (PROGRESSION.md "Level_Entry unlocking and state", VIEWER.md "Level states (viewer)")
import { PROG } from '../data.js';

const statusFlagCache = new WeakMap();
function statusFlags(status) {
    if (!statusFlagCache.has(status)) statusFlagCache.set(status, new Map(status.levels.map((l) => [l.name, l.flags])));
    return statusFlagCache.get(status);
}
// per level, its flags in the status; undefined for a level not entered yet
export function levelFlagsOf(status) {
    const flags = statusFlags(status);
    return PROG.levels.map((l) => flags.get(l.n));
}
export function isSolved(levelFlags, i) {
    return ((levelFlags[i] ?? 0) & 1) === 1;
}
export function isPartlySolved(levelFlags, i) {
    return ((levelFlags[i] ?? 0) & 2) !== 0;
}
// whether level j counts toward an ice gate: solved, or partly solved for a gate that takes that
export function gateOptionMet(freezer, level, levelFlags) {
    return isSolved(levelFlags, level) || (!!freezer.partial && isPartlySolved(levelFlags, level));
}
// whether a sign's rule holds: the rank reached (255: any), the tower active, or enough gold rooms found
export function signRuleMet(sign, status, towers, goldFound) {
    if (sign.rank) return sign.rank === 255 || sign.rank <= status.rank;
    if (sign.tower != null) return !!towers[sign.tower]?.active;
    if (sign.gold) return goldFound >= sign.gold;
    return false;
}
function gateSatisfied(fz, levelFlags, signOk) {
    const ok = [...fz.req.map((i) => gateOptionMet(fz, i, levelFlags)), ...(fz.signs || []).map(signOk)];
    return ok.length > 0 && (fz.or ? ok.some(Boolean) : ok.every(Boolean));
}
// ice gates: opened when listed in the status, or when their gate is satisfied now (re-evaluated at every overworld load)
export function iceGatesOpen(status, levelFlags, signOk) {
    const listed = new Set(status.openedFreezers);
    return PROG.freezers.map((fz) => listed.has(fz.pid) || (!fz.judge && gateSatisfied(fz, levelFlags, signOk)));
}
function requirementsMet(level, levelFlags) {
    if (!level.req.length) return true;
    if (level.or) return level.req.some((i) => isSolved(levelFlags, i));
    return level.req.every((i) => isSolved(levelFlags, i));
}
// a level enabled in the level data is open from the start whatever its gate; without a reachability model an open
// level counts as reachable
function levelState(level, i, levelFlags, reach) {
    if (isSolved(levelFlags, i)) return 'solved';
    if (isPartlySolved(levelFlags, i)) return 'partial';
    if (levelFlags[i] !== undefined) return 'visited';
    if (!level.en && !requirementsMet(level, levelFlags)) return 'locked';
    if (!reach || reach.level[i]) return 'unlocked';
    return 'blocked';
}
export function levelStates(levelFlags, reach) {
    return PROG.levels.map((level, i) => levelState(level, i, levelFlags, reach));
}
// Whether a level opens only once its requirements are met: not enabled from the start, and (for an OR level) no
// option solved yet
function waitsForRequirements(level, solved) {
    if (level.en || !level.req.length) return false;
    if (level.or && level.req.length > 1) return !level.req.some(solved);
    return true;
}
// The unsolved levels whose requirements need level i: an AND level that requires i or such a level, an OR level all
// of whose options are i or such levels. A walk back along `unlocks` (per level, the levels requiring it), counting
// the options an OR level has left.
export function levelsNeedingLevel(levels, unlocks, solved, i) {
    const needing = new Set(),
        optionsLeft = new Map(),
        queue = [i];
    while (queue.length) {
        const required = queue.pop();
        for (const j of unlocks[required].levels) {
            if (needing.has(j) || solved(j) || !waitsForRequirements(levels[j], solved)) continue;
            if (levels[j].or && levels[j].req.length > 1) {
                if (!optionsLeft.has(j)) optionsLeft.set(j, new Set(levels[j].req));
                const left = optionsLeft.get(j);
                left.delete(required);
                if (left.size) continue;
            }
            needing.add(j);
            queue.push(j);
        }
    }
    return needing;
}
// the options of a level's or ice gate's requirements: its levels and signs
export const optionCount = (node) => node.req.length + (node.signs?.length ?? 0);
