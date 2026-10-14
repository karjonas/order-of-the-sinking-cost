// A level's panel on the map: its state and role, area and set, the ice gate it is in, the path to unlock it, the gates
// in front of it and why it is not reachable, its tower, what it requires and unlocks (VIEWER.md "The page (viewer)")
import { PROG } from '../data.js';
import { esc, prettyAch } from '../util.js';
import { STATES, stLabel } from '../model/progress.js';
import { roleFor } from '../model/goal-roles.js';
import { unlockPlan } from '../model/plans.js';
import { towerName } from '../model/towers.js';
import { areaName } from '../sidebar/areas.js';
import { markSelected, NEAR } from './list.js';
import {
    chainOf,
    gateChip,
    gateMode,
    layerNote,
    opensChips,
    panelHead,
    pathHtml,
    pick,
    pointsOf,
    roleChipHtml,
    stepsOf,
    uniqueLinks,
} from './plan-chips.js';
import { approxTip, wayIn, whyParts, whyText } from './why.js';

function stateChipsHtml(context, i) {
    const level = context.levels[i];
    const levelState = context.progress.state[i];
    let tip = '';
    if (levelState === 'blocked') tip = ` title="${approxTip(context)}"`;
    let role = null;
    if (levelState !== 'solved') role = roleFor(context.goal, 'l', i);
    let achievement = '';
    if (level.a) achievement = `<span class="chip acc">${esc(prettyAch(level.a))}</span>`;
    return `<div><span class="chip ${STATES[levelState][1]}"${tip}>${stLabel(context.progress, levelState)}</span>${roleChipHtml(context, role)}${achievement}</div>`;
}
function whereHtml(context, i) {
    const level = context.levels[i];
    let html = '';
    const areaIndex = context.areaOf(i);
    if (areaIndex != null)
        html += `<div class="muted">${level.areaNear ? NEAR : ''}${esc(areaName(context.areas[areaIndex]))}</div>`;
    if (level.set) {
        const set = PROG.sets[level.set[0]];
        html += `<div class="muted">${esc(set.name)} · ${level.set[1]}${context.hide ? '' : ` of ${set.n}`}</div>`;
    }
    return html;
}
function iceGateHtml(context, ice) {
    const freezer = context.freezers[ice];
    let html = `<div class="h">In an ice gate</div><div>${gateChip(context, ice)}</div>`;
    if (context.progress.gateOpen[ice]) return html + '<div class="muted">Ice gate open</div>';
    const mode = gateMode(freezer);
    return html + `<div class="hs">Opens with${mode ? ' ' + mode : ''}</div><div>${opensChips(context, freezer)}</div>`;
}
// closed gates on the edge of the reached area that lead here; opening any one of them is enough
function behindGatesHtml(context, behind, gateIds) {
    if (!gateIds.length) return '';
    const plural = gateIds.length > 1 ? 's (any one)' : '';
    const heading = `<div class="h">${behind.length > gateIds.length ? 'Or behind' : 'Behind'} ice gate${plural}</div>`;
    const gates = gateIds.map((fi) => {
        const freezer = context.freezers[fi];
        const mode = gateMode(freezer);
        let modeNote = '';
        if (mode) modeNote = ' <span class="muted">· ' + mode + '</span>';
        return `<div><button class="plain lnk" data-pgate="${fi}" title="Gate at ${context.gateAt(fi)}">Ice gate · ${esc(context.gateName(fi))}</button>${modeNote}</div><div>${opensChips(context, freezer)}</div>`;
    });
    return heading + gates.join('');
}
// a tower level also lists what its tower still needs
function towerHtml(context, i, ti, tower, required, dropdowns) {
    const level = context.levels[i];
    let count = `${tower.solvedNormal} / ${tower.req}`;
    if (tower.active) count = 'activated';
    let html = `<div class="h"><button class="plain lnk" data-ptower="${ti}">${esc(towerName(level.t))}</button>${level.d ? ' · dropdown' : ''} · ${count}</div>`;
    if (required.length) html += `<div class="hs">Required</div><div>${pick(context, required)}</div>`;
    if (dropdowns.length) html += `<div class="hs">Dropdowns</div><div>${pick(context, dropdowns)}</div>`;
    return html;
}
// the other towers this level brings closer to done
function countsTowardHtml(context, i, ti) {
    const progress = context.progress;
    const counts = (progress.needed[i]?.towers || [])
        .filter(([tower]) => tower !== ti && !progress.towerHidden[tower])
        .toSorted((a, b) => a[1] - b[1]);
    if (!counts.length) return '';
    const chips = counts.map(
        ([tower, left]) =>
            `<span class="chip" data-ptower="${tower}" tabindex="0" role="button">${esc(towerName(progress.towers[tower].t))}<span class="muted"> · ${left} to go</span></span>`,
    );
    return `<div class="h">Counts toward</div><div>${chips.join('')}</div>`;
}

export function showLevelPanel(context, i, how) {
    const progress = context.progress;
    context.remember(['level', i]);
    markSelected(context, i);
    const level = context.levels[i],
        unlocks = progress.unlocks[i];
    const blocked = progress.state[i] === 'blocked';
    let html = panelHead(context, esc(level.n));
    html += stateChipsHtml(context, i);
    html += whereHtml(context, i);
    const ice = context.iceOf[i];
    if (ice != null) html += iceGateHtml(context, ice);
    let plan = null;
    if (progress.state[i] === 'locked' || blocked) plan = unlockPlan(progress, ['level', i]);
    const steps = plan && stepsOf(context, plan),
        chain = chainOf(context, plan, steps);
    html += pathHtml(context, plan, true, steps) + layerNote(context, chain, level.p[2]);
    context.chainPoints = chain.pts;
    // a gate that opens only from inside the level's pocket is no way in, and one the Path above names needs no second
    // mention
    const named = new Set();
    if (plan)
        plan.nodes.forEach((node, key) => {
            if (node.t === 'g' && steps.num.has(key)) named.add(node.id);
        });
    let behind = [];
    if (blocked) behind = wayIn(context, i).filter((fi) => fi !== ice);
    const gateIds = behind.filter((fi) => !named.has(fi)),
        gates = gateIds.map((fi) => context.freezers[fi]);
    html += behindGatesHtml(context, behind, gateIds);
    if (blocked) {
        let text = whyText(context, i);
        if (behind.length || (ice != null && progress.behind[i].includes(ice))) text = whyParts(context, i).mech;
        if (text) html += `<div class="muted">${esc(text[0].toUpperCase() + text.slice(1))}</div>`;
    }
    const ti = context.towerOf(i);
    let tower = null;
    if (ti >= 0 && !progress.towerHidden[ti]) tower = progress.towers[ti];
    const left = (ids) => ids.filter((j) => j !== i && progress.state[j] !== 'solved');
    let required = [],
        dropdowns = [];
    if (tower) {
        required = left(tower.normal);
        dropdowns = left(tower.drop).filter((j) => !progress.hidden[j]);
        html += towerHtml(context, i, ti, tower, required, dropdowns);
    }
    html += countsTowardHtml(context, i, ti);
    if (level.req.length)
        html += `<div class="h">Requires${level.or && level.req.length > 1 ? ' any of' : ''}</div><div>${pick(context, level.req)}</div>`;
    const unlockedGates = context.freezers
        .map((freezer, fi) => fi)
        .filter((fi) => context.freezers[fi].req.includes(i) && context.gateShown(context.freezers[fi]));
    if (unlocks.levels.length || unlockedGates.length)
        html += `<div class="h">Unlocks</div><div>${pick(context, unlocks.levels)}${unlockedGates.map((fi) => gateChip(context, fi)).join('')}</div>`;
    html += `<div class="showlist"><button class="plain lnk" data-goto="${i}">Show in list</button></div>`;
    const links = uniqueLinks([
        ...level.req.map((j) => [j, i, 'req']),
        ...unlocks.levels.map((j) => [i, j, 'unl']),
        ...(tower ? [[i, tower.p, 'unl']] : []),
        ...unlockedGates.map((fi) => [i, context.freezers[fi].p, 'unl']),
        ...gates.flatMap((freezer) => [[freezer.p, i, 'req'], ...freezer.req.map((j) => [j, freezer.p, 'req'])]),
        ...chain.links,
    ]);
    const gateLevels = gates.flatMap((freezer) => freezer.req);
    context.map.select(
        {
            levels: new Set([
                i,
                ...level.req,
                ...unlocks.levels,
                ...required,
                ...dropdowns,
                ...gateLevels,
                ...chain.levels,
            ]),
            focus: i,
            frontier: chain.frontier,
            ov: new Set([...chain.ov, ...unlockedGates.map((fi) => 'g' + fi)]),
            tower: tower ? ti : undefined,
            html,
            z: level.p[2],
            pts: [
                level.p,
                ...pointsOf(context, [...level.req, ...unlocks.levels]),
                ...(tower ? [tower.p] : []),
                ...gates.map((freezer) => freezer.p),
                ...unlockedGates.map((fi) => context.freezers[fi].p),
                ...chain.pts,
            ],
            links,
            steps: chain.steps,
        },
        how,
    );
}
