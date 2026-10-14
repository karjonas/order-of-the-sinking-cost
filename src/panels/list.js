// The results list: the goal's levels in groups, the chips that narrow it, its count, and showing a level in it
// (VIEWER.md "The page (viewer)")
import { $, countBy, esc } from '../util.js';
import { clearNarrowing, listAllLayers } from '../shared.js';
import { bar, pct } from '../format.js';
import { AREA_LAYERS, layerName } from '../model/layers.js';
import { stLabel } from '../model/progress.js';
import { towerName } from '../model/towers.js';
import { roleDot, ROLES } from '../map/icons.js';
import { refreshSideAreas, syncSide } from '../sidebar.js';
import { refreshSideGoals } from '../sidebar/goals.js';
import { areaName } from '../sidebar/areas.js';
import { chipOfState, STATE_CHIPS } from './context.js';
import { stateDot, wrappable } from './plan-chips.js';
import { approxTip, whyText } from './why.js';
import { keyHtml } from './markers.js';

// the list's groups in order, as the model groups its levels; solved levels follow when their chip is on
const GROUP_HEADS = {
    playable: 'Play now',
    blocked: 'Not reachable yet',
    locked: 'Locked',
    solved: 'Solved',
};
// the groups whose levels on other routes than the goal's cheapest plans are listed open, by goal and group
const routesOpen = new Set();
export const NEAR = '<span class="muted" title="Outside every area box; grouped with the nearest area">≈ </span>';

// solved levels out of the levels not under fog, with the partially solved ones in the bar
function stripHtml(context) {
    const progress = context.progress;
    const notHidden = context.levels.length - context.hiddenCount();
    const partial = progress.state.filter((levelState, i) => levelState === 'partial' && !progress.hidden[i]).length;
    return `<span class="pc" title="of levels not under fog">${pct(progress.solved, notHidden)} <span class="lb">solved</span></span>${bar(progress.solved, notHidden, partial)}`;
}
function rowHtml(context, i, tab) {
    const level = context.levels[i];
    const entry = context.entries.get(i);
    const levelState = context.progress.state[i];
    const areaIndex = context.areaOf(i);
    let area = '';
    if (areaIndex != null) area = areaName(context.areas[areaIndex]);
    let where = '';
    if (area) where = (level.areaNear ? NEAR : '') + esc(area);
    let layerTag = '';
    if (context.mapLayer && !context.inView(i))
        layerTag = `<span class="lt">${esc(layerName(context.layerOf(i)))}</span>`;
    // the level's own area is left off when the text already ends with it
    let line = where;
    if (entry.leadsTo) {
        line = esc(entry.leadsTo);
        if (where && !entry.leadsTo.endsWith(area)) line += ' · ' + where;
    }
    let why = '';
    if (entry.group === 'blocked') why = whyText(context, i);
    const roleText = entry.role ? ROLES[entry.role][0] : '';
    const tip = [stLabel(context.progress, levelState), roleText, entry.leadsTo && '→ ' + entry.leadsTo, why, area]
        .filter(Boolean)
        .join(' · ');
    const classes = ['plain', 'rr'];
    if (!entry.role) classes.push('nr');
    if (context.selected === i) classes.push('on');
    return `<button class="${classes.join(' ')}" id="pg-${i}" data-sel="${i}" tabindex="${tab ? 0 : -1}" title="${esc(tip)}">${stateDot(levelState)}${roleDot(entry.role)}<span class="nm">${wrappable(level.n)}</span><span class="ar">${layerTag}${line}</span></button>`;
}
// matches on the map's other layers, as "3 more on Sky · 1 on Underworld"
function moreHtml(context) {
    const byLayer = countBy(context.others, (i) => context.layerOf(i));
    const parts = AREA_LAYERS.filter((key) => byLayer.has(key)).map(
        (key, index) =>
            `<button class="plain lnk" data-layer-go="${key}">${byLayer.get(key)} ${index ? '' : 'more '}on ${esc(layerName(key))}</button>`,
    );
    if (!parts.length) return '';
    return `<div class="foot muted">${parts.join(' · ')}</div>`;
}
export const routeKey = (context, group) => `${context.goal.key}|${group}`;
export function toggleRoutes(context, group) {
    const key = routeKey(context, group);
    if (routesOpen.has(key)) routesOpen.delete(key);
    else routesOpen.add(key);
}
// the listed levels per group, on the goal's cheapest plans first; the off-plan one-of levels are `off`, listed only
// while open or while a search is on
function layoutRows(context) {
    const isOffPlan = (i) => context.isOffPlan(i);
    return Object.keys(GROUP_HEADS).flatMap((group) => {
        const members = context.list.filter((i) => context.entries.get(i).group === group);
        if (!members.length) return [];
        // a group with nothing on the cheapest plans lists what it has
        const hasOnPlan = members.some((i) => !isOffPlan(i));
        let off = [];
        if (!context.filters.q && hasOnPlan) off = members.filter(isOffPlan);
        const offSet = new Set(off);
        const open = routesOpen.has(routeKey(context, group));
        const onPlan = members.filter((i) => !offSet.has(i));
        let shown = onPlan;
        if (open) shown = [...onPlan, ...off];
        return [{ group, total: members.length, shown, off: off.length, open }];
    });
}
function groupHead(context, group) {
    if (group === 'blocked') return `<span title="${approxTip(context)}">${GROUP_HEADS[group]}</span>`;
    return GROUP_HEADS[group];
}
function rowsHtml(context, blocks, tab) {
    return blocks
        .map((block) => {
            const head = `<div class="rg">${groupHead(context, block.group)} <span class="c muted">· ${block.total}</span></div>`;
            let more = '';
            if (block.off) {
                const text = block.open ? `Hide ${block.off} on other routes` : `${block.off} more on other routes`;
                more = `<button class="plain lnk more" id="pgmore-${block.group}" data-routes="${block.group}" aria-expanded="${block.open}">${text}</button>`;
            }
            return head + block.shown.map((i) => rowHtml(context, i, i === tab)).join('') + more;
        })
        .join('');
}
function emptyHtml(context) {
    const goal = context.goal;
    if (!goal) return '<div class="none muted">Working out the goals…</div>';
    if (context.narrowed()) {
        let everything = '';
        if (context.filters.q && goal.kind !== 'completionist')
            everything = ' <button data-all-levels>Search every level</button>';
        return `<div class="none"><span class="muted">No levels match.</span> <button data-clear>Clear filters</button>${everything}</div>`;
    }
    if (goal.done) return `<div class="none muted">${esc(goal.label)} is done.</div>`;
    if (context.matched.length) return '<div class="none muted">No more on this layer.</div>';
    if (goal.fogged) return '<div class="none muted">Nothing to show yet; more is under fog.</div>';
    return `<div class="none muted">No levels left for ${esc(goal.label)}.</div>`;
}
// the chips above the list: the tower and area chips, removable, then the state chips, which narrow the list
function chipsHtml(context) {
    if (!context.goal) return '';
    const filters = context.filters;
    const area = filters.area !== '' && context.areas[filters.area];
    const tower = filters.tower !== '' && context.progress.towers[filters.tower];
    const counted = context.goalIds.filter(
        (i) => context.keptByNarrowing(i) && (context.listsEveryLayer() || context.inView(i)),
    );
    const counts = countBy(counted, (i) => chipOfState(context.progress.state[i]));
    let html = '';
    if (tower)
        html += `<button class="plain chip rm" data-clear-tower title="Show every tower">${esc(towerName(tower.t))} <span aria-hidden="true">×</span></button>`;
    if (area)
        html += `<button class="plain chip rm" data-clear-area title="Show every area">${esc(areaName(area))} <span aria-hidden="true">×</span></button>`;
    for (const [key, label] of STATE_CHIPS) {
        if (key === 'blocked' && !context.progress.reach) continue;
        const on = filters.states.includes(key),
            count = counts.get(key) || 0,
            disabled = !on && !count ? ' disabled' : '';
        html += `<button class="plain chip st${on ? ' on' : ''}" id="pgst-${key}" data-state="${key}" aria-pressed="${on}"${disabled}>${label} <span class="n">${count}</span></button>`;
    }
    return html;
}
function countHtml(context) {
    const goal = context.goal;
    if (!goal) return '';
    const total = context.goalIds.filter(
        (i) => context.entries.get(i).group !== 'solved' && (context.listsEveryLayer() || context.inView(i)),
    ).length;
    let of = '';
    if (context.narrowed() && context.list.length !== total) of = ` <span class="muted">of ${total}</span>`;
    let allLayers = '';
    if (context.map && context.map.layers.length > 1)
        allLayers = `<button id="pgAll" class="${listAllLayers ? 'on' : ''}" aria-pressed="${listAllLayers}" data-alllayers title="List the levels of every layer, not only the map's">All layers</button>`;
    return `<span><b>${esc(goal.label)}</b> · ${context.list.length}${of}</span>${allLayers}`;
}
export function drawList(context) {
    const active = document.activeElement;
    let refocus = null;
    if (active?.id && (active.closest('#pgRows') || active.closest('#pgChips') || active.id === 'pgAll'))
        refocus = active.id;
    const blocks = layoutRows(context),
        visible = blocks.flatMap((block) => block.shown);
    const tab = visible.includes(context.selected) ? context.selected : visible[0];
    let foot = '';
    if (context.hiddenCount()) foot = `<div class="foot muted">More levels under fog</div>`;
    $('#pgRows').innerHTML = (rowsHtml(context, blocks, tab) || emptyHtml(context)) + foot + moreHtml(context);
    $('#pgCount').innerHTML = countHtml(context);
    $('#pgChips').innerHTML = chipsHtml(context);
    if (refocus) document.getElementById(refocus)?.focus({ preventScroll: true });
}
// marks the map's selected level in the list and scrolls it into view there
export function markSelected(context, i) {
    context.selected = i;
    const rows = $('#pgRows');
    rows.querySelectorAll('.rr.on').forEach((row) => row.classList.remove('on'));
    const row = i != null && $('#pg-' + i);
    if (!row) return;
    row.classList.add('on');
    // only the list scrolls, centering the row; scrolling the page would push the map's panel out of view
    if (row.offsetTop < rows.scrollTop || row.offsetTop + row.offsetHeight > rows.scrollTop + rows.clientHeight)
        rows.scrollTop = row.offsetTop - (rows.clientHeight - row.offsetHeight) / 2;
}
// the filter changed: the goal, the list, the strip and the map's key and markers follow
export function apply(context, redraw = true) {
    const before = context.goal?.key;
    context.loadGoal();
    const goalChanged = context.goal?.key !== before;
    context.computeMatches();
    context.matched = context.goalIds.filter((i) => context.match(i));
    if (context.listsEveryLayer()) context.list = context.matched;
    else context.list = context.matched.filter((i) => context.inView(i));
    const layers = context.map ? context.map.layers : AREA_LAYERS;
    if (context.listsEveryLayer() || !context.mapLayer) context.others = [];
    else context.others = context.matched.filter((i) => !context.inView(i) && layers.includes(context.layerOf(i)));
    syncSide(context.filters);
    drawList(context);
    $('.strip').innerHTML = stripHtml(context);
    const map = context.map;
    if (map) {
        if (goalChanged) context.mapOptions.overlays = context.overlays();
        map.setKey(keyHtml(context));
        if (redraw) map.redraw();
    }
    // the open panel names its level's role for the goal
    if (goalChanged && context.current && map?.open) context.open(context.current, { still: true });
}
// the map changed layer: the lists follow it
export function layerChanged(context, layerKey) {
    context.mapLayer = layerKey;
    apply(context, false);
    refreshSideAreas();
    if (context.selected != null) markSelected(context, context.selected);
}
// lists a level of a closed group of other routes
function openRoutesOf(context, i) {
    if (!context.goal || context.filters.q || !context.isOffPlan(i)) return;
    routesOpen.add(routeKey(context, context.entries.get(i).group));
    drawList(context);
}
// shows a level the list does not keep: the chips go, the solved chip comes on for a solved level, and a level the goal
// has no use for brings in Completionist, which lists every level
function showInList(context, i) {
    clearNarrowing(context.filters);
    if (context.progress.state[i] === 'solved') context.filters.states = ['solved'];
    apply(context);
    if (context.match(i)) return;
    context.filters.goal = 'completionist';
    apply(context);
    refreshSideGoals();
}
// shows a level in the list: marks and flashes its row; toList (the list was asked for) first clears the chips that
// hide it and also brings the list into the page view (it sits above the map in narrow windows) and focuses the row
export function goto(context, id, toList) {
    const i = Number(id);
    const map = context.map;
    if (map && !context.listsEveryLayer() && !context.inView(i)) map.setLayer(context.layerOf(i));
    if (!context.match(i)) {
        if (!toList) {
            markSelected(context, null);
            return;
        }
        showInList(context, i);
    }
    openRoutesOf(context, i);
    markSelected(context, i);
    const row = $('#pg-' + i);
    if (!row) return;
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1200);
    if (toList) {
        $('.rlist').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        row.focus({ preventScroll: true });
    }
}
