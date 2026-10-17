// The results list: the goal's levels in groups, the chips that narrow it, its count, and showing a level in it
// (VIEWER.md "The page (viewer)")
import { $, countBy, escapeHtml } from '../util.ts';
import { clearNarrowing, listAllLayers } from '../shared.ts';
import { percent, progressBarHtml } from '../format.ts';
import { roleDot, ROLES } from '../map/icons.ts';
import { areaName } from '../model/areas.ts';
import { AREA_LAYERS, layerName } from '../model/layers.ts';
import { stateLabel } from '../model/progress.ts';
import { towerName } from '../model/towers.ts';
import type { TowerProgress } from '../model/towers.ts';
import type { Area } from '../types.ts';
import { refreshSideAreas, syncSide } from '../sidebar.ts';
import { refreshSideGoals } from '../sidebar/goals.ts';
import { chipOfState, STATE_CHIPS } from './context.ts';
import type { ListedLevel, PanelContext } from './context.ts';
import { keyHtml } from './markers.ts';
import { stateDot, wrappable } from './plan-chips.ts';
import { approxTip, whyText } from './why.ts';

type ListGroup = ListedLevel['group'];

/** The levels of one group of the list in the order they are listed. */
interface RowBlock {
    group: ListGroup;
    shown: number[];
}

// the list's groups in order, as the model groups its levels; solved levels follow when their chip is on
const GROUP_ORDER: ListGroup[] = ['playable', 'blocked', 'locked', 'solved'];

const GROUP_HEADS: Record<ListGroup, string> = {
    playable: 'Play now',
    blocked: 'Not reachable yet',
    locked: 'Locked',
    solved: 'Solved',
};

export const NEAR = '<span class="muted" title="Outside every area box; grouped with the nearest area">≈ </span>';

// solved levels out of the levels not under fog, with the partially solved ones in the bar
function stripHtml(context: PanelContext): string {
    const progress = context.progress;
    const notHidden = context.levels.length - context.hiddenCount();
    const partial = progress.state.filter(
        (levelState, levelIndex) => levelState === 'partial' && !progress.hidden[levelIndex],
    ).length;

    const solvedPercent = percent(progress.solved, notHidden);
    const bar = progressBarHtml(progress.solved, notHidden, partial);
    const label = `${solvedPercent} <span class="lb">solved</span>`;
    return `<span class="pc" title="of levels not under fog">${label}</span>${bar}`;
}

function rowHtml(context: PanelContext, levelIndex: number, tab: boolean): string {
    const level = context.levels[levelIndex];
    const entry = context.entryOf(levelIndex);
    const levelState = context.progress.state[levelIndex];
    const areaIndex = context.areaOf(levelIndex);
    let area = '';
    if (areaIndex != null) area = areaName(context.areas[areaIndex]);

    let where = '';
    if (area) {
        if (level.areaNear) where = NEAR;
        where += escapeHtml(area);
    }

    let layerTag = '';
    if (context.mapLayer && !context.inView(levelIndex)) {
        layerTag = `<span class="lt">${escapeHtml(layerName(context.layerOf(levelIndex)))}</span>`;
    }

    // the level's own area is left off when the text already ends with it
    let line = where;
    if (entry.leadsTo) {
        line = escapeHtml(entry.leadsTo);
        if (where && !entry.leadsTo.endsWith(area)) line += ' · ' + where;
    }

    let why = '';
    if (entry.group === 'blocked') why = whyText(context, levelIndex);

    let roleText = '';
    if (entry.role) roleText = ROLES[entry.role][0];

    let leadsText = '';
    if (entry.leadsTo) leadsText = '→ ' + entry.leadsTo;

    const stateText = stateLabel(context.progress, levelState);
    const tip = [stateText, roleText, leadsText, why, area].filter(Boolean).join(' · ');

    const classes = ['plain', 'rr'];
    if (!entry.role) classes.push('nr');
    if (context.selected === levelIndex) classes.push('on');

    let tabIndex = -1;
    if (tab) tabIndex = 0;

    const title = escapeHtml(tip);
    const attributes = `id="pg-${levelIndex}" data-sel="${levelIndex}" tabindex="${tabIndex}" title="${title}"`;
    const dots = stateDot(levelState) + roleDot(entry.role);
    const name = `<span class="nm">${wrappable(level.n)}</span>`;
    const areaLine = `<span class="ar">${layerTag}${line}</span>`;
    return `<button class="${classes.join(' ')}" ${attributes}>${dots}${name}${areaLine}</button>`;
}

// matches on the map's other layers, as "3 more on Sky · 1 on Underworld"
function moreHtml(context: PanelContext): string {
    const byLayer = countBy(context.others, (levelIndex) => context.layerOf(levelIndex));
    const parts = AREA_LAYERS.filter((key) => byLayer.has(key)).map((key, index) => {
        let more = '';
        if (!index) more = 'more ';

        const name = escapeHtml(layerName(key));
        return `<button class="plain lnk" data-layer-go="${key}">${byLayer.get(key)} ${more}on ${name}</button>`;
    });

    if (!parts.length) return '';
    return `<div class="foot muted">${parts.join(' · ')}</div>`;
}

// the listed levels per group: the ones on the goal's cheapest plans first, then the one-of levels that could stand in
// for them
function layoutRows(context: PanelContext): RowBlock[] {
    const isOffPlan = (levelIndex: number): boolean => context.isOffPlan(levelIndex);
    const blocks: RowBlock[] = [];

    for (const group of GROUP_ORDER) {
        const members = context.list.filter((levelIndex) => context.entryOf(levelIndex).group === group);
        if (!members.length) continue;

        const onPlan = members.filter((levelIndex) => !isOffPlan(levelIndex));
        const offPlan = members.filter(isOffPlan);
        blocks.push({ group, shown: [...onPlan, ...offPlan] });
    }

    return blocks;
}

function groupHead(context: PanelContext, group: ListGroup): string {
    if (group === 'blocked') return `<span title="${approxTip(context)}">${GROUP_HEADS[group]}</span>`;
    return GROUP_HEADS[group];
}

function rowsHtml(context: PanelContext, blocks: RowBlock[], tab: number | undefined): string {
    return blocks
        .map((block) => {
            const title = groupHead(context, block.group);
            const head = `<div class="rg">${title} <span class="c muted">· ${block.shown.length}</span></div>`;
            const rows = block.shown.map((levelIndex) => rowHtml(context, levelIndex, levelIndex === tab));
            return head + rows.join('');
        })
        .join('');
}

function emptyHtml(context: PanelContext): string {
    const goal = context.goal;
    if (!goal) return '<div class="none muted">Working out the goals…</div>';

    if (context.narrowed()) {
        let everything = '';
        const everyState = context.filters.states.length === STATE_CHIPS.length;
        if (context.filters.q && (goal.kind !== 'completionist' || !everyState)) {
            everything = ' <button data-all-levels>Search every level</button>';
        }

        const clearButton = '<button data-clear>Clear filters</button>';
        return `<div class="none"><span class="muted">No levels match.</span> ${clearButton}${everything}</div>`;
    }

    if (goal.done) return `<div class="none muted">${escapeHtml(goal.label)} is done.</div>`;
    if (context.matched.length) return '<div class="none muted">No more on this layer.</div>';
    if (goal.fogged) return '<div class="none muted">Nothing to show yet; more is under fog.</div>';
    return `<div class="none muted">No levels left for ${escapeHtml(goal.label)}.</div>`;
}

// the chips above the list: the tower and area chips, removable, then the state chips, which narrow the list
function chipsHtml(context: PanelContext): string {
    if (!context.goal) return '';

    const filters = context.filters;
    let area: Area | undefined;
    if (filters.area !== '') area = context.areas[Number(filters.area)];

    let tower: TowerProgress | undefined;
    if (filters.tower !== '') tower = context.progress.towers[Number(filters.tower)];

    const counted = context.goalIds.filter(
        (levelIndex) =>
            context.keptByNarrowing(levelIndex) && (context.listsEveryLayer() || context.inView(levelIndex)),
    );
    const counts = countBy(counted, (levelIndex) => chipOfState(context.progress.state[levelIndex]));
    const closeMark = '<span aria-hidden="true">×</span>';
    let html = '';
    if (tower) {
        const name = escapeHtml(towerName(tower.t));
        const attributes = 'data-clear-tower title="Show every tower"';
        html += `<button class="plain chip rm" ${attributes}>${name} ${closeMark}</button>`;
    }

    if (area) {
        const name = escapeHtml(areaName(area));
        const attributes = 'data-clear-area title="Show every area"';
        html += `<button class="plain chip rm" ${attributes}>${name} ${closeMark}</button>`;
    }

    for (const [key, label] of STATE_CHIPS) {
        if (key === 'blocked' && !context.progress.reach) continue;

        const pressed = filters.states.includes(key);
        const count = counts.get(key) || 0;
        let pressedClass = '';
        if (pressed) pressedClass = ' on';
        let disabled = '';
        if (!pressed && !count) disabled = ' disabled';

        const attributes = `id="pgst-${key}" data-state="${key}" aria-pressed="${pressed}"${disabled}`;
        const countSpan = `<span class="n">${count}</span>`;
        html += `<button class="plain chip st${pressedClass}" ${attributes}>${label} ${countSpan}</button>`;
    }

    return html;
}

function countHtml(context: PanelContext): string {
    const goal = context.goal;
    if (!goal) return '';

    const total = context.goalIds.filter(
        (levelIndex) =>
            context.entryOf(levelIndex).group !== 'solved' && (context.listsEveryLayer() || context.inView(levelIndex)),
    ).length;

    let outOf = '';
    if (context.narrowed() && context.list.length !== total) outOf = ` <span class="muted">of ${total}</span>`;

    let allLayers = '';
    if (context.map && context.map.layers.length > 1) {
        let onClass = '';
        if (listAllLayers) onClass = 'on';

        const title = "List the levels of every layer, not only the map's";
        const pressed = `aria-pressed="${listAllLayers}"`;
        const attributes = `id="pgAll" class="${onClass}" ${pressed} data-alllayers title="${title}"`;
        allLayers = `<button ${attributes}>All layers</button>`;
    }

    return `<span><b>${escapeHtml(goal.label)}</b> · ${context.list.length}${outOf}</span>${allLayers}`;
}

function drawList(context: PanelContext): void {
    const active = document.activeElement;
    let refocus: string | null = null;
    if (active?.id && (active.closest('#pgRows') || active.closest('#pgChips') || active.id === 'pgAll')) {
        refocus = active.id;
    }

    const blocks = layoutRows(context);
    const visible = blocks.flatMap((block) => block.shown);
    let tab: number | undefined = visible[0];
    if (context.selected !== null && visible.includes(context.selected)) tab = context.selected;

    let foot = '';
    if (context.hiddenCount()) foot = `<div class="foot muted">More levels under fog</div>`;

    $('#pgRows').innerHTML = (rowsHtml(context, blocks, tab) || emptyHtml(context)) + foot + moreHtml(context);
    $('#pgCount').innerHTML = countHtml(context);
    $('#pgChips').innerHTML = chipsHtml(context);
    if (refocus) document.getElementById(refocus)?.focus({ preventScroll: true });
}

/** Marks the map's selected level in the list and scrolls it into view there. */
export function markSelected(context: PanelContext, levelIndex: number | null): void {
    context.selected = levelIndex;
    const rows = $('#pgRows');
    rows.querySelectorAll('.rr.on').forEach((row) => row.classList.remove('on'));
    if (levelIndex === null) return;

    const row = $('#pg-' + levelIndex);
    if (!row) return;

    row.classList.add('on');

    // only the list scrolls, centering the row; scrolling the page would push the map's panel out of view
    if (row.offsetTop < rows.scrollTop || row.offsetTop + row.offsetHeight > rows.scrollTop + rows.clientHeight) {
        rows.scrollTop = row.offsetTop - (rows.clientHeight - row.offsetHeight) / 2;
    }
}

/** The filter changed: the goal, the list, the strip and the map's key and markers follow. */
export function applyFilters(context: PanelContext, redraw = true): void {
    const before = context.goal?.key;
    context.loadGoal();
    const goalChanged = context.goal?.key !== before;

    context.computeMatches();
    context.matched = context.goalIds.filter((levelIndex) => context.match(levelIndex));
    if (context.listsEveryLayer()) context.list = context.matched;
    else context.list = context.matched.filter((levelIndex) => context.inView(levelIndex));

    const layers = context.map ? context.map.layers : AREA_LAYERS;
    if (context.listsEveryLayer() || !context.mapLayer) {
        context.others = [];
    } else {
        context.others = context.matched.filter(
            (levelIndex) => !context.inView(levelIndex) && layers.includes(context.layerOf(levelIndex)),
        );
    }

    syncSide(context.filters);
    drawList(context);
    $('.strip').innerHTML = stripHtml(context);

    const map = context.map;
    if (map) {
        if (goalChanged && context.mapOptions) context.mapOptions.overlays = context.overlays();
        map.setKey(keyHtml(context));
        if (redraw) map.redraw();
    }

    // the open panel names its level's role for the goal
    if (goalChanged && context.current && map?.open) context.open(context.current, { still: true });
}

/** The map changed layer: the lists follow it. */
export function layerChanged(context: PanelContext, layerKey: string): void {
    context.mapLayer = layerKey;
    applyFilters(context, false);

    refreshSideAreas();
    if (context.selected !== null) markSelected(context, context.selected);
}

// shows a level the list does not keep: the chips go, the solved chip comes on for a solved level, and a level the goal
// has no use for brings in Completionist, which lists every level
function showInList(context: PanelContext, levelIndex: number): void {
    clearNarrowing(context.filters);
    if (context.progress.state[levelIndex] === 'solved') context.filters.states = ['solved'];
    applyFilters(context);
    if (context.match(levelIndex)) return;

    context.filters.goal = 'completionist';
    applyFilters(context);
    refreshSideGoals();
}

/**
 * Shows a level in the list: marks and flashes its row; toList (the list was asked for) first clears the chips that
 * hide it and also brings the list into the page view (it sits above the map in narrow windows) and focuses the row.
 */
export function showLevelRow(context: PanelContext, id: number | string, toList?: boolean): void {
    const levelIndex = Number(id);
    const map = context.map;
    if (map && !context.listsEveryLayer() && !context.inView(levelIndex)) map.setLayer(context.layerOf(levelIndex));

    if (!context.match(levelIndex)) {
        if (!toList) {
            markSelected(context, null);
            return;
        }

        showInList(context, levelIndex);
    }

    markSelected(context, levelIndex);

    const row = $('#pg-' + levelIndex);
    if (!row) return;

    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1200);
    if (toList) {
        $('.rlist').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        row.focus({ preventScroll: true });
    }
}
