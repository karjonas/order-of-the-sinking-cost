// The list of one kind of mark in the results column, in place of the goal's levels: what is left to do first, then the
// done ones when asked for (VIEWER.md "The page (viewer)")
import { $, compareText, escapeHtml } from '../util.ts';
import type { PanelKey } from '../shared.ts';
import { iconHtml } from '../map/icons.ts';
import type { IconName } from '../map/icons.ts';
import type { MapOptions, MapOverlay, MapTower } from '../map/map-view.ts';
import { findLabel } from '../model/find-kinds.ts';
import type { FindKind } from '../model/find-kinds.ts';
import { AREA_LAYERS, layerName, mapLayerOf } from '../model/layers.ts';
import { towerName } from '../model/towers.ts';
import type { PanelContext } from './context.ts';
import { layerTagHtml } from './plan-chips.ts';

/** A mark of the kind as the list shows it. */
export interface FindItem {
    id: string;
    icon: IconName;
    /** The area it is in, else its layer; for a tower's pad, the tower. */
    place: string;
    state: string;
    done: boolean;
    layer: string;
    x: number;
    y: number;
    /** The panel the item opens; null where the kind has none. */
    panel: PanelKey | null;
}

// where a mark is: the area it is in while that area is shown, else its layer; a mark on the fast-travel screen (two
// voice logs) is on no map layer
function placeOf(context: PanelContext, overlay: MapOverlay): string {
    if (overlay.place !== undefined) return overlay.place;

    const area = context.model.areaAt(overlay.position);
    if (area !== null) return area;
    if (overlay.layer === undefined) return 'Fast-travel screen';
    return layerName(overlay.layer);
}

function overlayItem(context: PanelContext, overlay: MapOverlay): FindItem {
    return {
        id: overlay.id,
        icon: overlay.icon,
        place: placeOf(context, overlay),
        state: overlay.state,
        done: overlay.done,
        layer: overlay.layer,
        x: overlay.x,
        y: overlay.y,
        panel: overlay.panel ?? null,
    };
}

function towerPadItem(context: PanelContext, tower: MapTower): FindItem {
    let state = 'Not discovered';
    if (tower.padFound) state = 'Discovered';

    return {
        id: 'w' + tower.towerIndex,
        icon: 'tower-pad',
        place: towerName(context.progress.towers[tower.towerIndex].t),
        state,
        done: tower.padFound,
        layer: mapLayerOf(tower.z),
        x: tower.x,
        y: tower.y,
        panel: ['tower', tower.towerIndex],
    };
}

// the layer the map shows first, then the others in their order, each by place
function sortItems(context: PanelContext, items: FindItem[]): FindItem[] {
    const layerRank = (layer: string): number => {
        if (layer === context.mapLayer) return -1;
        return AREA_LAYERS.indexOf(layer);
    };

    return items.toSorted((first, second) => {
        const byLayer = layerRank(first.layer) - layerRank(second.layer);
        if (byLayer !== 0) return byLayer;
        return compareText(first.place, second.place);
    });
}

// the towers whose pads the Tower pads list holds, beside the gold rooms' Antipode endpoints, which are overlays
function listedTowers(options: MapOptions, kind: FindKind): MapTower[] {
    if (kind !== 'towerPads') return [];
    return options.towers.filter((tower) => tower.onPad);
}

/** The marks of a kind that are not under fog. */
export function findItemsOf(context: PanelContext, kind: FindKind): FindItem[] {
    const options = context.mapOptions;
    if (!options) return [];

    const overlays = options.overlays.filter((overlay) => overlay.findKind === kind);
    const items = [
        ...overlays.map((overlay) => overlayItem(context, overlay)),
        ...listedTowers(options, kind).map((tower) => towerPadItem(context, tower)),
    ];

    return sortItems(context, items);
}

/** The listed mark of a kind with an id, without building the others; undefined for none. */
export function findItemOf(context: PanelContext, kind: FindKind, id: string): FindItem | undefined {
    const options = context.mapOptions;
    if (!options) return undefined;

    const overlay = options.overlays.find((each) => each.findKind === kind && each.id === id);
    if (overlay) return overlayItem(context, overlay);

    const tower = listedTowers(options, kind).find((each) => 'w' + each.towerIndex === id);
    if (tower) return towerPadItem(context, tower);
    return undefined;
}

function rowHtml(context: PanelContext, item: FindItem, tab: boolean): string {
    let tabIndex = -1;
    if (tab) tabIndex = 0;

    // the layer is named when it is not the map's, unless the place already is the layer's name
    const place = item.place;
    let layerTag = '';
    if (context.mapLayer && item.layer && item.layer !== context.mapLayer && place !== layerName(item.layer)) {
        layerTag = layerTagHtml(item.layer);
    }

    // the marks of one place are told apart by the nearest level; a tower's pad is named by its tower
    let near = '';
    if (item.panel?.[0] !== 'tower') {
        const level = context.model.nearestShownLevel(item.x, item.y, item.layer);
        if (level >= 0) near = ` <span class="muted">· near ${escapeHtml(context.levels[level].n)}</span>`;
    }

    let iconClass = '';
    if (item.done) iconClass = 'dn';

    const id = escapeHtml(item.id);
    const attributes = `id="pgf-${id}" data-find-item="${id}" tabindex="${tabIndex}"`;
    const state = `<span class="muted">· ${escapeHtml(item.state.toLowerCase())}</span>`;
    const name = `<span class="nm">${layerTag}${escapeHtml(place)}${near} ${state}</span>`;
    return `<button class="plain rr fi" ${attributes}>${iconHtml(item.icon, iconClass)}${name}</button>`;
}

function groupHtml(context: PanelContext, title: string, items: FindItem[], first: boolean): string {
    const head = `<div class="rg">${title} <span class="c muted">· ${items.length}</span></div>`;
    const rows = items.map((item, index) => rowHtml(context, item, first && index === 0));
    return head + rows.join('');
}

/** Draws the list of a kind into the results column's heading, chips and rows. */
export function drawFindList(context: PanelContext, kind: FindKind): void {
    const filters = context.filters;
    const items = findItemsOf(context, kind);
    const todo = items.filter((item) => !item.done);
    const done = items.filter((item) => item.done);

    const back = '<button class="plain lnk" data-find-back title="Back to the goal\'s levels">‹ Back</button>';
    const left = `<b>${escapeHtml(findLabel(kind))}</b> · ${todo.length} left`;
    $('#pgCount').innerHTML = `<span class="fh">${back}<span>${left}</span></span>`;

    let pressedClass = '';
    if (filters.findDone) pressedClass = ' on';

    let disabled = '';
    if (!filters.findDone && !done.length) disabled = ' disabled';

    const chipAttributes = `data-find-done aria-pressed="${filters.findDone}"${disabled}`;
    const count = `<span class="n">${done.length}</span>`;
    $('#pgChips').innerHTML = `<button class="plain chip st${pressedClass}" ${chipAttributes}>Solved ${count}</button>`;

    let html = '';
    if (todo.length) html += groupHtml(context, 'Still to do', todo, true);
    if (filters.findDone && done.length) html += groupHtml(context, 'Done', done, !todo.length);
    if (!html) html = `<div class="none muted">Nothing left to find here.</div>`;
    $('#pgRows').innerHTML = html;
}
