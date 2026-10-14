// Completion progress of a campaign from its saves: level states, towers, ice gates, the walk's reach, the ways into
// the levels it cannot reach and the plans built on them (rules: PROGRESSION.md "Level_Entry unlocking and state", the
// viewer's model: VIEWER.md "Level states (viewer)", data: data/progress.json)
import { PROG, WORLD } from '../data.js';
import { latestOf } from '../save.js';
import { reachability } from '../walk/reachability.js';
import { teleporterStatesOf } from '../walk/teleporters.js';
import { goalLadder } from './goals.js';
import { ROLE } from './level-roles.js';
import { nextSteps } from './next-steps.js';
import { planAll } from './plans.js';
import { towerProgress } from './towers.js';
import { iceGatesOpen, isSolved, levelFlagsOf, levelStates, signRuleMet } from './unlocking.js';
import { accessOf, gatesBehind, unlocksOf, wayInModel } from './way-in.js';

export const RANKS = ['Visitor', 'Egressant', 'Pusher', 'Arranger', 'Intrepid', 'Sokoban'];
export const STATES = {
    solved: ['Solved', 'good'],
    partial: ['Partially solved', 'warn'],
    visited: ['Entered', 'acc'],
    unlocked: ['Reachable', ''],
    blocked: ['Blocked', ''],
    locked: ['Locked', 'bad'],
};
// without a reachability model an open level is only known to be not entered yet
export const stLabel = (progress, state) =>
    state === 'unlocked' && !progress.reach ? 'Not entered' : STATES[state][0];
// per status: the history, the progress, the ROLE it was computed under and how to redo progress.wayIn under another
let progressCache = new WeakMap();
export const setProgressCache = (v) => {
    progressCache = v;
};
// the walk over the overworld state; null for the empty save, which has no walked places to start the fill from
function reachOf(history, latest, tst, gateOpen, levelFlags) {
    if (!latest || !WORLD || !PROG.world || history.demo) return null;
    const closed = gateOpen.map((o) => !o),
        entered = levelFlags.map((x) => x !== undefined);
    return reachability(history, latest, tst, closed, entered);
}
export function computeProgress(status, history) {
    const hit = progressCache.get(status);
    if (hit && hit.history === history) {
        // roles computed since: only the parts built on them change
        if (hit.role !== ROLE) {
            hit.role = ROLE;
            hit.progress.wayIn = hit.wayIn();
            hit.progress.plans = planAll(hit.progress);
            hit.progress.needed = nextSteps(hit.progress, status);
            hit.progress.goals = goalLadder(hit.progress, status);
        }
        return hit.progress;
    }
    const levelFlags = levelFlagsOf(status);
    const solved = (i) => isSolved(levelFlags, i);
    const towers = towerProgress(solved);
    const latest = history ? latestOf(history) : null,
        teleporterStates = teleporterStatesOf(latest);
    const goldFound = (PROG.teleporters || []).filter((t, i) => t.gold && teleporterStates[i].disc).length;
    const signOk = (g) => signRuleMet(g, status, towers, goldFound);
    const gateOpen = iceGatesOpen(status, levelFlags, signOk);
    const reach = reachOf(history, latest, teleporterStates, gateOpen, levelFlags);
    const state = levelStates(levelFlags, reach);
    const unlocks = unlocksOf();
    const behind = gatesBehind(reach);
    const { why, wayInOf, wayInFixed, ice } = wayInModel({
        levelFlags,
        solved,
        state,
        reach,
        unlocks,
        behind,
        gateOpen,
    });
    const progress = {
        state,
        unlocks,
        towers,
        gateOpen,
        tst: teleporterStates,
        goldFound,
        signOk,
        reach,
        behind,
        why,
        wayIn: wayInOf(),
        wayInFixed,
        access: accessOf(state, reach),
        ice,
        lt: latest,
        solved: state.filter((x) => x === 'solved').length,
    };
    progress.plans = planAll(progress);
    progress.needed = nextSteps(progress, status);
    progress.goals = goalLadder(progress, status);
    progressCache.set(status, { history, progress, role: ROLE, wayIn: wayInOf });
    return progress;
}
