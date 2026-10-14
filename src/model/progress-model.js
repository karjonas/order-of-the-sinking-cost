// The progress model of a campaign: progress, fog, areas and the totals the page shows
// (VIEWER.md "The spoiler model (viewer)")
import { PROG } from '../data.js';
import { historyEntry, statusEntry } from '../files.js';
import { fogOf, NO_FOG } from '../fog.js';
import { filtersOf, revealedOf, spoilersHidden } from '../shared.js';
import { achievementRules, ENDINGS, hasAchievement } from './achievements.js';
import { activePins, heroAreaAt, levelAreaOf } from './areas.js';
import { goalsView } from './goals-view.js';
import { FOG_LAYER_KEYS, mapLayerOf, wrapDelta } from './layers.js';
import { computeProgress } from './progress.js';
import { totalsOf } from './totals.js';

export function progressModel(camp) {
    const statusFile = statusEntry(camp),
        status = statusFile.parsed,
        history = historyEntry(camp)?.parsed || null,
        progress = computeProgress(status, history),
        levels = PROG.levels;
    const fogData = fogOf(camp),
        fog = fogData || NO_FOG,
        hide = spoilersHidden;
    const rev = revealedOf(camp);
    // the overworld level the save is in (the status names `overworld` or a menu level otherwise); never a spoiler
    // Status names the level until it is saved again after leaving it; the file times don't tell the two apart
    const onOverworld = !statusFile.demo && status.currentLevel === 'overworld';
    const cur = statusFile.demo ? -1 : levels.findIndex((l) => l.n === status.currentLevel),
        inLevel = cur >= 0 ? cur : null;
    // without fog data only entered and solved levels count as uncovered
    progress.hidden = levels.map(
        (l, i) =>
            hide &&
            i !== inLevel &&
            !rev.has(i) &&
            progress.state[i] !== 'solved' &&
            (fogData ? fog.levelHidden(l.n, l.p) : progress.state[i] !== 'visited' && progress.state[i] !== 'partial'),
    );
    progress.towerHidden = progress.towers.map(
        (t) => hide && !t.active && fog.at(mapLayerOf(t.p[2]), t.p[0], t.p[1], t.p[2]),
    );
    // the game names an area only while its pin is activated; a level in an unnamed area (or outside every area box) shows none
    const areas = PROG.areas || [],
        pinsOn = activePins(history);
    const areaShown = (ai) => !hide || pinsOn.has(areas[ai].pin);
    const levelArea = levels.map((l) => levelAreaOf(l, pinsOn));
    // totals and overlays list a thing that is not under fog, or that the save already found
    const shownAt = (key, p) => !!key && !(hide && fog.at(key, p[0], p[1], p[2]));
    // the layers the fog has uncovered; null when nothing is hidden
    const known = hide ? fog.knownLayers() : null;
    const totals = totalsOf({ status, progress, hide, shownAt, known });
    // signs: the ones that open gates and the tower status signs; a status sign of a tower under fog is left out
    const SG = PROG.signs || [];
    const signs = SG.map((sg, i) => i).filter(
        (i) => shownAt(FOG_LAYER_KEYS[SG[i].l], SG[i].p) && !(SG[i].status && progress.towerHidden[SG[i].tower]),
    );
    // with fogged things hidden, an unearned achievement is hidden while what earns it is: all its levels under fog, its
    // tower under fog, or its layer not uncovered yet. An ending shows once every ending before it is earned: the names
    // are public, but each one only follows the one before.
    const achRules = achievementRules(progress);
    const nextEnding = ENDINGS.findIndex(([, name]) => !hasAchievement(status, name));
    const achievementHidden = (name) => {
        if (!hide || hasAchievement(status, name)) return false;
        const endingIndex = ENDINGS.findIndex(([, endingName]) => endingName === name);
        if (endingIndex >= 0) return endingIndex > nextEnding;
        const rule = achRules.get(name);
        if (!rule) return false;
        if (rule.levels?.every((i) => progress.hidden[i])) return true;
        if (rule.tower && progress.towerHidden[progress.towers.indexOf(rule.tower)]) return true;
        return !!rule.layer && !known.includes(rule.layer);
    };
    // the endings in rank order, whether earned, and whether the page shows it
    const endings = ENDINGS.map(([, name]) => ({
        name,
        earned: hasAchievement(status, name),
        shown: !achievementHidden(name),
    }));
    // an ice gate is named by the area it stands in while that area is shown, else by its position
    const gatePins = hide ? pinsOn : new Set(areas.map((a) => a.pin));
    const gateArea = (fi) => {
        const area = heroAreaAt(PROG.freezers[fi].p, gatePins);
        if (area == null) return null;
        return areas[area].display || areas[area].local_area_name;
    };
    const gateShown = (fi) => shownAt(FOG_LAYER_KEYS[PROG.freezers[fi].l], PROG.freezers[fi].p);
    // a plan step as the player sees it: levels, gates and towers under fog are left out; a gold room shows where the
    // totals show it, the way onto a layer once that layer has cleared fog, a rank marker while its achievement shows
    const stepShown = (node) => {
        if (node.t === 'l') return !progress.hidden[node.id];
        if (node.t === 'g') return gateShown(node.id);
        if (node.t === 't') return !progress.towerHidden[node.id];
        if (node.t === 'p') return totals.rooms.includes(PROG.gold_rooms[node.id]);
        if (node.t === 'a') return !hide || known.includes(node.id);
        if (node.t === 'e') return !achievementHidden(node.id);
        return true;
    };
    // the distance from the hero to a level, wrapped, the levels on the hero's layer first
    const heroDist = (i) => {
        const at = history?.hero,
            size = (PROG.world?.grid || PROG.map)?.size;
        if (!at || !size) return 0;
        const p = levels[i].p,
            sameLayer = mapLayerOf(p[2]) === mapLayerOf(at[2]);
        return Math.hypot(wrapDelta(p[0] - at[0], size[0]), wrapDelta(p[1] - at[1], size[1])) + (sameLayer ? 0 : 1e6);
    };
    const goalView = goalsView({
        status,
        progress,
        levels,
        endings,
        achievementHidden,
        achievementRule: (name) => achRules.get(name),
        gateShown,
        gateArea,
        stepShown,
        heroDist,
    });
    const hero = history?.hero ? { x: history.hero[0], y: history.hero[1], z: history.hero[2] } : null;
    // the status names the area only while on the overworld; inside levels it reads 0, so the history's hero position stands in
    let heroArea = null;
    if (onOverworld) {
        const ai = status.currentAreaPin ? areas.findIndex((a) => a.pin === status.currentAreaPin) : -1;
        heroArea = ai >= 0 ? ai : heroAreaAt(history?.hero, pinsOn);
    }
    return {
        status,
        progress,
        levels,
        fog,
        hide,
        noFog: !fogData,
        areaShown,
        levelArea,
        shownAt,
        teleporters: totals.T,
        padDisc: totals.padDisc,
        gates: totals.gates,
        signs,
        signSet: new Set(signs),
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
