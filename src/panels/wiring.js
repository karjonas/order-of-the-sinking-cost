// The progress view's events: clicks in the list, the chips and the panels, the sidebar's hooks into the view (open a
// level, frame a tower, an area or a totals row, name a revealed level), the list's arrow keys and the panel the
// address names (VIEWER.md "The page (viewer)")
import { $, countBy } from '../util.js';
import { clearNarrowing, hooks, listAllLayers, setListAllLayers, setPref } from '../shared.js';
import { mapLayerOf } from '../model/layers.js';
import { syncSide } from '../sidebar.js';
import { refreshSideGoals } from '../sidebar/goals.js';
import { hashDone, markHashDone, panelKeep, setHash } from './hash.js';
import { apply, drawList, goto, toggleRoutes } from './list.js';

// the chips in a panel that open another panel: data attribute, node kind
const PANEL_CHIPS = [
    ['ptower', 'tower'],
    ['pgate', 'gate'],
    ['psign', 'sign'],
    ['pick', 'level'],
];
// a totals row's marker class and the overlay that shows its kind
const FIND_MARKS = { tps: ['tp', 'tps'], gold: ['gr', 'tps'], logs: ['vl', 'logs'] };

// clicks in the map's panel: a layer note frames its steps there, a chip opens its node's panel, which Back leaves again
export function wireMapPanels(context) {
    const map = context.map;
    $('#pgMap')
        .querySelector('.sel')
        .addEventListener('click', (event) => {
            const layerNote = event.target.closest('[data-clayer]');
            if (layerNote) {
                map.fitPts(context.chainPoints.filter((point) => mapLayerOf(point[2]) === layerNote.dataset.clayer));
                return;
            }
            for (const [attribute, kind] of PANEL_CHIPS) {
                const chip = event.target.closest(`[data-${attribute}]`);
                if (chip) {
                    context.back.push(context.current);
                    context.selectors[kind](Number(chip.dataset[attribute]));
                    return;
                }
            }
            if (event.target.closest('[data-back]') && context.back.length) context.open(context.back.pop());
        });
    // a panel opened from the map starts a new panel history
    const openFresh = (kind) => (id) => {
        context.back.length = 0;
        context.selectors[kind](id);
    };
    map.onPick = openFresh('level');
    map.onTower = openFresh('tower');
    map.onGate = openFresh('gate');
    map.onSign = openFresh('sign');
}

const scrollToMap = () => $('#pgMap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
function showOnMap(context, kind, id, how) {
    if (!context.map) return;
    context.selectors[kind](id, how);
    scrollToMap();
}

// a totals row frames the things of its kind not found yet that are not under fog, on the layer the map shows when it
// has any, else the one with most; a second click goes back to the view and overlays from before
function findOnMap(context, kind) {
    const map = context.map;
    const filters = context.filters;
    if (!map) return;
    if (filters.find === kind) {
        for (const overlay of context.findBack?.turned || []) map.setOverlay(overlay, false);
        if (context.findBack) map.setView(context.findBack.view);
        context.findBack = null;
        filters.find = '';
        syncSide(filters);
        return;
    }
    const points = context.model.finds[kind].open;
    if (!points.length) return;
    if (!filters.find) context.findBack = { view: map.getView(), turned: new Set() };
    const [markerClass, overlay] = FIND_MARKS[kind];
    if (overlay && !map.setOverlay(overlay, true)) context.findBack?.turned.add(overlay);
    const perLayer = countBy(points, (point) => mapLayerOf(point[2]));
    let target = map.layer;
    if (!perLayer.has(map.layer)) target = [...perLayer].toSorted((a, b) => b[1] - a[1])[0][0];
    filters.find = kind;
    syncSide(filters);
    const onTarget = (point) => mapLayerOf(point[2]) === target;
    map.fitPts(points.toSorted((a, b) => onTarget(b) - onTarget(a)));
    map.flash(markerClass);
    scrollToMap();
}
// a revealed level gets its name everywhere: list, tooltips and the open panel
function revealed(context) {
    if (context.mapOptions) context.mapOptions.overlays = context.overlays();
    apply(context);
    if (!context.current || !context.map?.open) return;
    const inPanel = $('#pgMap .sel').contains(document.activeElement);
    context.open(context.current, { still: true });
    if (inPanel || document.activeElement === document.body) $('#pgMap .sel .hd b')?.focus({ preventScroll: true });
}
function wireHooks(context) {
    const filters = context.filters;
    hooks.tower = (ti) => showOnMap(context, 'tower', ti);
    hooks.open = (i) => {
        goto(context, i);
        showOnMap(context, 'level', i);
    };
    // an area picked in the sidebar is framed by all of its levels not under fog, whatever the list filter keeps
    hooks.area = () => {
        const points = context.levels
            .filter(
                (level, i) => !context.progress.hidden[i] && String(context.model.levelArea[i] ?? '') === filters.area,
            )
            .map((level) => level.p);
        if (context.map && points.length) context.map.fitPts(points);
    };
    hooks.find = (kind) => findOnMap(context, kind);
    hooks.reveal = () => revealed(context);
}

// the row an arrow, Home or End key moves the focus to
function rowIndexFor(key, at, count) {
    let index = at - 1;
    if (key === 'Home') index = 0;
    else if (key === 'End') index = count - 1;
    else if (key === 'ArrowDown') index = at + 1;
    return Math.max(0, Math.min(count - 1, index));
}
// the list is one tab stop: the focused row takes it, the arrow keys move between rows
function wireRowKeys() {
    const rows = $('#pgRows');
    rows.addEventListener('focusin', (event) => {
        const row = event.target.closest('.rr');
        if (!row) return;
        rows.querySelectorAll('.rr[tabindex="0"]').forEach((each) => (each.tabIndex = -1));
        row.tabIndex = 0;
    });
    rows.addEventListener('keydown', (event) => {
        if (!event.target.closest('.rr') || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const all = [...rows.querySelectorAll('.rr')],
            at = all.indexOf(event.target.closest('.rr'));
        event.preventDefault();
        all[rowIndexFor(event.key, at, all.length)].focus();
    });
}

const CLICK_TARGETS =
    '[data-goto],[data-sel],[data-clear],[data-all-levels],[data-clear-area],[data-clear-tower],[data-state],[data-routes],[data-layer-go],[data-alllayers]';
function onPageClick(context, event) {
    const target = event.target.closest(CLICK_TARGETS);
    if (!target) return;
    const filters = context.filters;
    const data = target.dataset;
    if (data.goto != null) goto(context, data.goto, true);
    else if (data.sel != null) showOnMap(context, 'level', Number(data.sel), { keepFocus: true });
    else if (data.layerGo != null) context.map?.setLayer(data.layerGo);
    else if (data.alllayers != null) {
        setListAllLayers(!listAllLayers);
        setPref('listAllLayers', listAllLayers ? '1' : '0');
        apply(context, false);
    } else if (data.state != null) {
        const key = data.state;
        if (filters.states.includes(key)) filters.states = filters.states.filter((each) => each !== key);
        else filters.states = [...filters.states, key];
        apply(context);
    } else if (data.routes != null) {
        toggleRoutes(context, data.routes);
        drawList(context);
    } else if (data.clearArea != null) {
        filters.area = '';
        apply(context);
        $('#pgRows .rr[tabindex="0"]')?.focus({ preventScroll: true });
    } else if (data.clearTower != null) {
        filters.tower = '';
        apply(context);
        $('#pgRows .rr[tabindex="0"]')?.focus({ preventScroll: true });
    } else if (data.allLevels != null) {
        filters.goal = 'completionist';
        apply(context);
        refreshSideGoals();
    } else if (data.clear != null) {
        const inList = !!target.closest('#pgRows');
        clearNarrowing(filters);
        apply(context);
        if (inList) $('#pgRows .rr')?.focus({ preventScroll: true });
    }
}

export function wirePage(context) {
    wireHooks(context);
    wireRowKeys();
    const onClick = (event) => onPageClick(context, event);
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the shell elements outlive a render and the handler replaces the last one
    $('#main').onclick = $('#results').onclick = onClick;
}

// whether a kept or addressed panel's thing exists for the save and is not under fog
function panelValid(context, [kind, id]) {
    if (kind === 'level') return !context.progress.hidden[id];
    if (kind === 'tower') return !context.progress.towerHidden[id];
    if (kind === 'gate') return context.gateShown(context.freezers[id]);
    return context.model.signSet.has(id);
}
function addressedId(context, kind, value) {
    if (kind === 'level') return context.levels.findIndex((level) => level.n === value);
    if (/^\d+$/.test(value)) return Number(value);
    return -1;
}
// the target of the address, when it names something that exists and is not under fog
function addressTarget(context) {
    let found;
    try {
        found = /^(level|tower|gate|sign)=(.+)$/.exec(decodeURIComponent(location.hash.slice(1)));
    } catch {}
    if (!found) return null;
    const [, kind, value] = found;
    const id = addressedId(context, kind, value);
    const counts = {
        level: context.levels.length,
        tower: context.progress.towers.length,
        gate: context.freezers.length,
        sign: context.signs.length,
    };
    if (id >= 0 && id < counts[kind] && panelValid(context, [kind, id])) return [kind, id];
    return null;
}
// opens the panel the address names; an address naming nothing closes the open one
function fromAddress(context) {
    const map = context.map;
    if (!map || context.model.demo) return;
    const target = addressTarget(context);
    if (!target) {
        if (!location.hash.slice(1) && map.open) map.select(null);
        return;
    }
    const current = context.current;
    if (current?.[0] === target[0] && current[1] === target[1]) return;
    if (target[0] === 'level') goto(context, target[1]);
    const openers = { level: map.onPick, tower: map.onTower, gate: map.onGate, sign: map.onSign };
    openers[target[0]](target[1]);
    scrollToMap();
}
// the panel kept for the campaign opens again; on the first draw of a save, the one the address names
export function openKeptPanel(context) {
    const map = context.map;
    const camp = context.camp;
    const kept = panelKeep[camp];
    const onAddress = () => fromAddress(context);
    hooks.hash = onAddress;
    if (map && kept && panelValid(context, kept)) {
        context.open(kept, { still: true });
        return;
    }
    if (kept) {
        delete panelKeep[camp];
        setHash('');
        return;
    }
    if (!map || context.model.demo) return;
    if (hashDone) {
        setHash('');
        return;
    }
    // the panel is fitted once the map has its final size
    map.ready(() => {
        if (hooks.hash !== onAddress) return;
        markHashDone();
        fromAddress(context);
        if (!context.current) setHash('');
    });
}
