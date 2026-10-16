// The progress view's events: clicks in the list, the chips and the panels, the sidebar's hooks into the view (open a
// level, frame a tower, an area or a totals row, name a revealed level), the list's arrow keys and the panel the
// address names (VIEWER.md "The page (viewer)")
import { $, countBy } from '../util.ts';
import { clearNarrowing, hooks, listAllLayers, setListAllLayers, setPreference } from '../shared.ts';
import type { FindKind, PanelKey, PanelKind } from '../shared.ts';
import type { OverlayKind } from '../map/map-html.ts';
import type { SelectHow } from '../map/map-view.ts';
import { mapLayerOf } from '../model/layers.ts';
import { syncSide } from '../sidebar.ts';
import { refreshSideGoals } from '../sidebar/goals.ts';
import type { PanelContext } from './context.ts';
import { hashDone, markHashDone, panelKeep, setHash } from './hash.ts';
import { applyFilters, showLevelRow } from './list.ts';

// the chips in a panel that open another panel: data attribute, node kind
const PANEL_CHIPS: Array<[attribute: string, kind: PanelKind]> = [
    ['ptower', 'tower'],
    ['pgate', 'gate'],
    ['psign', 'sign'],
    ['pick', 'level'],
];

// a totals row's marker class (a selector for the marks to pulse) and the overlay that shows its kind; the tower
// status signs share the signs' marks but are no part of the Signs row
const FIND_MARKS: Record<FindKind, [markerClass: string, overlay: OverlayKind]> = {
    signs: ['sg:not(.status)', 'gates'],
    tps: ['tp', 'tps'],
    logs: ['vl', 'logs'],
};

const isPanelKind = (value: string): value is PanelKind =>
    value === 'level' || value === 'tower' || value === 'gate' || value === 'sign';

/**
 * Clicks in the map's panel: a layer note frames its steps there, a chip opens its node's panel, which Back leaves again.
 */
export function wireMapPanels(context: PanelContext): void {
    const map = context.map;
    if (!map) return;

    $('#pgMap')
        .querySelector('.sel')
        ?.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;

            const layerNote = target.closest<HTMLElement>('[data-clayer]');
            if (layerNote) {
                const layerPoints = context.chainPoints.filter(
                    (point) => mapLayerOf(point[2]) === layerNote.dataset.clayer,
                );
                map.fitPoints(layerPoints);
                return;
            }

            for (const [attribute, kind] of PANEL_CHIPS) {
                const chip = target.closest<HTMLElement>(`[data-${attribute}]`);
                if (chip) {
                    if (context.current) context.back.push(context.current);
                    context.selectors[kind](Number(chip.dataset[attribute]));
                    return;
                }
            }

            if (target.closest('[data-back]')) {
                const previous = context.back.pop();
                if (previous) context.open(previous);
            }
        });

    // a panel opened from the map starts a new panel history
    const openFresh = (kind: PanelKind) => (id: number) => {
        context.back.length = 0;
        context.selectors[kind](id);
    };

    map.onPick = openFresh('level');
    map.onTower = openFresh('tower');
    map.onGate = openFresh('gate');
    map.onSign = openFresh('sign');
}

const scrollToMap = (): void => $('#pgMap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

function showOnMap(context: PanelContext, kind: PanelKind, id: number, how?: SelectHow): void {
    if (!context.map) return;

    context.selectors[kind](id, how);
    scrollToMap();
}

// a totals row frames the things of its kind not found yet that are not under fog, on the layer the map shows when it
// has any, else the one with most; a second click goes back to the view and overlays from before
function findOnMap(context: PanelContext, kind: FindKind): void {
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
    if (!map.setOverlay(overlay, true)) context.findBack?.turned.add(overlay);

    const perLayer = countBy(points, (point) => mapLayerOf(point[2]));
    let target = map.layer;
    if (!perLayer.has(map.layer)) {
        const byCount = [...perLayer].toSorted((first, second) => second[1] - first[1]);
        target = byCount[0][0];
    }

    filters.find = kind;
    syncSide(filters);

    const onTarget = (point: [number, number, number]): number => Number(mapLayerOf(point[2]) === target);
    map.fitPoints(points.toSorted((first, second) => onTarget(second) - onTarget(first)));
    map.flash(markerClass);
    scrollToMap();
}

// a revealed level gets its name everywhere: list, tooltips and the open panel
function revealed(context: PanelContext): void {
    if (context.mapOptions) context.mapOptions.overlays = context.overlays();
    applyFilters(context);
    if (!context.current || !context.map?.open) return;

    const inPanel = $('#pgMap .sel').contains(document.activeElement);
    context.open(context.current, { still: true });
    if (inPanel || document.activeElement === document.body) $('#pgMap .sel .hd b')?.focus({ preventScroll: true });
}

function wireHooks(context: PanelContext): void {
    const filters = context.filters;
    hooks.tower = (towerIndex) => showOnMap(context, 'tower', towerIndex);
    hooks.open = (levelIndex) => {
        showLevelRow(context, levelIndex);
        showOnMap(context, 'level', levelIndex);
    };

    // an area picked in the sidebar is framed by all of its levels not under fog, whatever the list filter keeps
    hooks.area = () => {
        const points = context.levels
            .filter(
                (_level, levelIndex) =>
                    !context.progress.hidden[levelIndex] &&
                    String(context.model.levelArea[levelIndex] ?? '') === filters.area,
            )
            .map((level) => level.p);
        if (context.map && points.length) context.map.fitPoints(points);
    };

    hooks.find = (kind) => findOnMap(context, kind);
    hooks.reveal = () => revealed(context);
}

// the row an arrow, Home or End key moves the focus to
function rowIndexFor(key: string, at: number, count: number): number {
    let index = at - 1;
    if (key === 'Home') index = 0;
    else if (key === 'End') index = count - 1;
    else if (key === 'ArrowDown') index = at + 1;
    return Math.max(0, Math.min(count - 1, index));
}

// the list is one tab stop: the focused row takes it, the arrow keys move between rows
function wireRowKeys(): void {
    const rows = $('#pgRows');
    rows.addEventListener('focusin', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const row = target.closest<HTMLElement>('.rr');
        if (!row) return;

        rows.querySelectorAll<HTMLElement>('.rr[tabindex="0"]').forEach((each) => {
            each.tabIndex = -1;
        });
        row.tabIndex = 0;
    });

    rows.addEventListener('keydown', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const focused = target.closest<HTMLElement>('.rr');
        if (!focused || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

        const all = [...rows.querySelectorAll<HTMLElement>('.rr')];
        const at = all.indexOf(focused);
        event.preventDefault();
        all[rowIndexFor(event.key, at, all.length)].focus();
    });
}

const CLICK_TARGET_ATTRIBUTES = [
    'data-goto',
    'data-sel',
    'data-clear',
    'data-all-levels',
    'data-clear-area',
    'data-clear-tower',
    'data-state',
    'data-layer-go',
    'data-alllayers',
];
const CLICK_TARGETS = CLICK_TARGET_ATTRIBUTES.map((attribute) => `[${attribute}]`).join(',');

function onPageClick(context: PanelContext, event: Event): void {
    const eventTarget = event.target;
    if (!(eventTarget instanceof Element)) return;

    const target = eventTarget.closest<HTMLElement>(CLICK_TARGETS);
    if (!target) return;

    const filters = context.filters;
    const data = target.dataset;
    if (data.goto != null) {
        showLevelRow(context, data.goto, true);
    } else if (data.sel != null) {
        showOnMap(context, 'level', Number(data.sel), { keepFocus: true });
    } else if (data.layerGo != null) {
        context.map?.setLayer(data.layerGo);
    } else if (data.alllayers != null) {
        setListAllLayers(!listAllLayers);
        setPreference('listAllLayers', listAllLayers ? '1' : '0');
        applyFilters(context, false);
    } else if (data.state != null) {
        const key = data.state;
        if (filters.states.includes(key)) filters.states = filters.states.filter((each) => each !== key);
        else filters.states = [...filters.states, key];
        applyFilters(context);
    } else if (data.clearArea != null) {
        filters.area = '';
        applyFilters(context);
        $('#pgRows .rr[tabindex="0"]')?.focus({ preventScroll: true });
    } else if (data.clearTower != null) {
        filters.tower = '';
        applyFilters(context);
        $('#pgRows .rr[tabindex="0"]')?.focus({ preventScroll: true });
    } else if (data.allLevels != null) {
        filters.goal = 'completionist';
        applyFilters(context);
        refreshSideGoals();
    } else if (data.clear != null) {
        const inList = !!target.closest('#pgRows');
        clearNarrowing(filters);
        applyFilters(context);
        if (inList) $('#pgRows .rr')?.focus({ preventScroll: true });
    }
}

export function wirePage(context: PanelContext): void {
    wireHooks(context);
    wireRowKeys();

    const onClick = (event: Event): void => onPageClick(context, event);

    for (const shell of [$('#main'), $('#results')]) {
        // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the shell elements outlive a render and the handler replaces the last one
        shell.onclick = onClick;
    }
}

// whether a kept or addressed panel's thing exists for the save and is not under fog
function panelValid(context: PanelContext, [kind, id]: PanelKey): boolean {
    if (kind === 'level') return !context.progress.hidden[id];
    if (kind === 'tower') return !context.progress.towerHidden[id];
    if (kind === 'gate') return context.gateShown(context.freezers[id]);
    return context.model.signSet.has(id);
}

function addressedId(context: PanelContext, kind: PanelKind, value: string): number {
    if (kind === 'level') return context.levels.findIndex((level) => level.n === value);
    if (/^\d+$/.test(value)) return Number(value);
    return -1;
}

// the target of the address, when it names something that exists and is not under fog
function addressTarget(context: PanelContext): PanelKey | null {
    let found: RegExpExecArray | null = null;

    try {
        found = /^(level|tower|gate|sign)=(.+)$/.exec(decodeURIComponent(location.hash.slice(1)));
    } catch {}
    if (!found) return null;

    const [, kind, value] = found;
    if (!isPanelKind(kind)) return null;

    const id = addressedId(context, kind, value);
    const counts: Record<PanelKind, number> = {
        level: context.levels.length,
        tower: context.progress.towers.length,
        gate: context.freezers.length,
        sign: context.signs.length,
    };

    if (id >= 0 && id < counts[kind] && panelValid(context, [kind, id])) return [kind, id];
    return null;
}

// opens the panel the address names; an address naming nothing closes the open one
function fromAddress(context: PanelContext): void {
    const map = context.map;
    if (!map || context.model.demo) return;

    const target = addressTarget(context);
    if (!target) {
        if (!location.hash.slice(1) && map.open) map.select(null);
        return;
    }

    const current = context.current;
    if (current?.[0] === target[0] && current[1] === target[1]) return;

    const [kind, id] = target;
    if (kind === 'level') showLevelRow(context, id);

    const openers = { level: map.onPick, tower: map.onTower, gate: map.onGate, sign: map.onSign };
    openers[kind]?.(id);
    scrollToMap();
}

/** The panel kept for the campaign opens again; on the first draw of a save, the one the address names. */
export function openKeptPanel(context: PanelContext): void {
    const map = context.map;
    const camp = context.camp;
    const kept = panelKeep[camp];
    const onAddress = (): void => fromAddress(context);
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
