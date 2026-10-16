// The progress model of a campaign: progress, fog, areas and the totals the page shows
// (VIEWER.md "The spoiler model (viewer)")
import { PROG } from '../data.ts';
import { historyEntry, statusEntry } from '../files.ts';
import { fogOf, NO_FOG } from '../fog.ts';
import type { Fog } from '../fog.ts';
import { filtersOf, revealedOf, spoilersHidden } from '../shared.ts';
import type { ProgressFilters } from '../shared.ts';
import type { DemoStatus, Status } from '../status-file.ts';
import type { GoldRoom, ProgressLevel, Teleporter, ViewGiver, VoiceLog } from '../types.ts';
import { achievementRules, ENDINGS, hasAchievement } from './achievements.ts';
import { activePins, areaName, heroAreaAt, levelAreaOf } from './areas.ts';
import { goalsView } from './goals-view.ts';
import type { EndingStatus, GoalLevel, GoalView } from './goals-view.ts';
import { FOG_LAYER_KEYS, mapLayerOf, wrapDelta } from './layers.ts';
import { computeProgress } from './progress.ts';
import type { ShownProgress } from './progress.ts';
import type { PlanStep } from './requirements.ts';
import { totalsOf } from './totals.ts';
import type { Finds, ShownAt, TotalsStats, TreasureTotals } from './totals.ts';

/** Everything the page's progress view reads for one campaign. */
export interface ProgressModel {
    status: Status | DemoStatus;
    progress: ShownProgress;
    levels: ProgressLevel[];
    fog: Fog;
    /** Whether spoilers are hidden. */
    hide: boolean;
    /** Whether the fog data is missing. */
    noFog: boolean;
    areaShown: (area: number) => boolean;
    /** Per level, the area it is in while that area is named; null for none. */
    levelArea: Array<number | null>;
    shownAt: ShownAt;
    teleporters: Teleporter[];
    padDisc: (teleporter: number) => boolean;
    gates: number[];
    signs: number[];
    signSet: Set<number>;
    logs: number[];
    maps: number[];
    heard: (log: VoiceLog) => boolean;
    taken: (giver: ViewGiver) => boolean;
    heroArea: number | null;
    achievementHidden: (name: string) => boolean;
    endings: EndingStatus[];
    goals: GoalView[];
    goalLevels: (goal: GoalView) => GoalLevel[];
    goalSolved: (goal: GoalView) => number[];
    goalByKey: (key: string) => GoalView | null;
    goalFor: (key: string) => GoalView | null;
    gateArea: (freezer: number) => string | null;
    stepShown: (step: PlanStep) => boolean;
    heroDist: (level: number) => number;
    onOverworld: boolean;
    pads: number[];
    rooms: GoldRoom[];
    treasures: TreasureTotals;
    stats: TotalsStats;
    finds: { signs: Finds; tps: Finds; logs: Finds };
    hero: { x: number; y: number; z: number } | null;
    /** The level the save is in; null for none. */
    inLevel: number | null;
    F: ProgressFilters;
    demo: boolean;
}

/** The progress model of one campaign (a folder name in the loaded saves). */
export function progressModel(camp: string): ProgressModel {
    const statusFile = statusEntry(camp)!;
    const status = statusFile.parsed!;
    const history = historyEntry(camp)?.parsed || null;
    const progress = computeProgress(status, history);
    const levels = PROG.levels;

    const fogData = fogOf(camp);
    const fog = fogData || NO_FOG;
    const hide = spoilersHidden;
    const revealedLevels = revealedOf(camp);

    // the overworld level the save is in (the status names `overworld` or a menu level otherwise); never a spoiler
    // Status names the level until it is saved again after leaving it; the file times don't tell the two apart
    const onOverworld = !statusFile.demo && status.currentLevel === 'overworld';
    const currentLevel = statusFile.demo ? -1 : levels.findIndex((level) => level.n === status.currentLevel);
    const inLevel = currentLevel >= 0 ? currentLevel : null;

    // without fog data only entered and solved levels count as uncovered
    const hidden = levels.map((level, i) => {
        if (!hide || i === inLevel || revealedLevels.has(i) || progress.state[i] === 'solved') return false;
        if (fogData) return fog.levelHidden(level.n, level.p);
        return progress.state[i] !== 'visited' && progress.state[i] !== 'partial';
    });

    const towerHidden = progress.towers.map(
        (tower) => hide && !tower.active && fog.at(mapLayerOf(tower.p[2]), tower.p[0], tower.p[1], tower.p[2]),
    );
    const shownProgress = Object.assign(progress, { hidden, towerHidden });

    // the game names an area only while its pin is activated; a level in an unnamed area (or outside every area box) shows none
    const areas = PROG.areas || [];
    const pinsOn = activePins(history);
    const areaShown = (area: number) => !hide || pinsOn.has(areas[area].pin);
    const levelArea = levels.map((level) => levelAreaOf(level, pinsOn));

    // totals and overlays list a thing that is not under fog, or that the save already found
    const shownAt: ShownAt = (key, position) => !!key && !(hide && fog.at(key, position[0], position[1], position[2]));

    // the layers the fog has uncovered; null when nothing is hidden
    const known = hide ? fog.knownLayers() : null;
    const totals = totalsOf({ status, progress: shownProgress, hide, shownAt, known });

    // signs: the ones that open gates and the tower status signs; a status sign of a tower under fog is left out
    const allSigns = PROG.signs || [];
    const signs: number[] = [];
    allSigns.forEach((sign, i) => {
        if (!shownAt(FOG_LAYER_KEYS[sign.l], sign.p)) return;
        if (sign.status && shownProgress.towerHidden[sign.tower!]) return;
        signs.push(i);
    });

    const signSet = new Set(signs);

    // with fogged things hidden, an unearned achievement is hidden while what earns it is: all its levels under fog, its
    // tower under fog, or its layer not uncovered yet. An ending shows once every ending before it is earned: the names
    // are public, but each one only follows the one before.
    const achievementRuleOf = achievementRules(shownProgress);
    const nextEnding = ENDINGS.findIndex(([, name]) => !hasAchievement(status, name));
    const achievementHidden = (name: string) => {
        if (!hide || hasAchievement(status, name)) return false;

        const endingIndex = ENDINGS.findIndex(([, endingAchievement]) => endingAchievement === name);
        if (endingIndex >= 0) return endingIndex > nextEnding;

        const rule = achievementRuleOf.get(name);
        if (!rule) return false;
        if (rule.levels?.every((i) => shownProgress.hidden[i])) return true;
        if (rule.tower && shownProgress.towerHidden[shownProgress.towers.indexOf(rule.tower)]) return true;
        return !!rule.layer && !known!.includes(rule.layer);
    };

    // the endings in rank order, whether earned, and whether the page shows it
    const endings = ENDINGS.map(([, name]): EndingStatus => ({
        name,
        earned: hasAchievement(status, name),
        shown: !achievementHidden(name),
    }));

    // a Freezer is named by the area it stands in while that area is shown, else by its position
    const gatePins = hide ? pinsOn : new Set(areas.map((area) => area.pin));
    const gateArea = (freezer: number) => {
        const area = heroAreaAt(PROG.freezers[freezer].p, gatePins);
        if (area == null) return null;
        return areaName(areas[area]);
    };

    const gateShown = (freezer: number) => shownAt(FOG_LAYER_KEYS[PROG.freezers[freezer].l], PROG.freezers[freezer].p);

    // a plan step as the player sees it: levels, gates, towers and signs under fog are left out; a gold room shows where
    // the totals show it, the way onto a layer once that layer has cleared fog, a rank marker while its achievement shows
    const stepShown = (step: PlanStep) => {
        if (step.t === 'l') return !shownProgress.hidden[step.id];
        if (step.t === 'g') return gateShown(step.id);
        if (step.t === 't') return !shownProgress.towerHidden[step.id];
        if (step.t === 'p') return totals.rooms.includes(PROG.gold_rooms[step.id]);
        if (step.t === 'a') return !hide || known!.includes(step.id);
        if (step.t === 'e') return !achievementHidden(step.id);

        // a sign rule that is no Sign in the data has no position, so nothing to be under fog
        if (step.t === 's' && step.id !== undefined) return signSet.has(step.id);
        return true;
    };

    // the distance from the hero to a level, wrapped, the levels on the hero's layer first
    const heroDist = (level: number) => {
        const heroAt = history?.hero;
        const size = (PROG.world?.grid || PROG.map)?.size;
        if (!heroAt || !size) return 0;

        const position = levels[level].p;
        const sameLayer = mapLayerOf(position[2]) === mapLayerOf(heroAt[2]);
        const distance = Math.hypot(
            wrapDelta(position[0] - heroAt[0], size[0]),
            wrapDelta(position[1] - heroAt[1], size[1]),
        );
        return distance + (sameLayer ? 0 : 1e6);
    };

    const goalView = goalsView({
        status,
        progress: shownProgress,
        levels,
        endings,
        achievementHidden,
        achievementRule: (name) => achievementRuleOf.get(name),
        gateShown,
        gateArea,
        signShown: (sign) => signSet.has(sign),
        stepShown,
        heroDist,
    });

    const hero = history?.hero ? { x: history.hero[0], y: history.hero[1], z: history.hero[2] } : null;

    // the status names the area only while on the overworld; inside levels it reads 0, so the history's hero position stands in
    let heroArea: number | null = null;
    if (onOverworld) {
        const pinArea = status.currentAreaPin ? areas.findIndex((area) => area.pin === status.currentAreaPin) : -1;
        heroArea = pinArea >= 0 ? pinArea : heroAreaAt(history?.hero, pinsOn);
    }

    return {
        status,
        progress: shownProgress,
        levels,
        fog,
        hide,
        noFog: !fogData,
        areaShown,
        levelArea,
        shownAt,
        teleporters: totals.teleporters,
        padDisc: totals.padDisc,
        gates: totals.gates,
        signs,
        signSet,
        logs: totals.logs,
        maps: totals.maps,
        heard: totals.heard,
        taken: totals.taken,
        heroArea,
        achievementHidden,
        endings,
        goals: goalView.goals,
        goalLevels: goalView.goalLevels,
        goalSolved: goalView.goalSolved,
        goalByKey: goalView.goalByKey,
        goalFor: goalView.goalFor,
        gateArea,
        stepShown,
        heroDist,
        onOverworld,
        pads: totals.pads,
        rooms: totals.rooms,
        treasures: totals.treasures,
        stats: totals.stats,
        finds: totals.finds,
        hero,
        inLevel,
        F: filtersOf(camp),
        demo: !!statusFile.demo,
    };
}
