// The progress view: the results list, the map and its panels (VIEWER.md "The page (viewer)")
import { PROG } from './data.ts';
import { $, escapeHtml } from './util.ts';
import { hooks } from './shared.ts';
import { SAVE_PATH } from './files.ts';
import type { Fog } from './fog.ts';
import { mapHtml, mapKeep, startLayer } from './map/map-html.ts';
import { mapInit } from './map/map-view.ts';
import type { MapOptions } from './map/map-view.ts';
import { oceanWater } from './map/layer-image.ts';
import type { ProgressModel } from './model/progress-model.ts';
import { refreshSideAreas } from './sidebar.ts';
import { copyPath, folderAction, folderLabel } from './folder.ts';
import { PanelContext } from './panels/context.ts';
import { panelKeep, setHash } from './panels/hash.ts';
import { applyFilters, layerChanged, markSelected } from './panels/list.ts';
import {
    areaLabels,
    keyHtml,
    levelMarkers,
    markerShown,
    markerStyle,
    overlaysOf,
    towerMarkers,
} from './panels/markers.ts';
import { showLevelPanel } from './panels/level-panel.ts';
import { showTowerPanel } from './panels/tower-panel.ts';
import { showGatePanel } from './panels/gate-panel.ts';
import { showSignPanel } from './panels/sign-panel.ts';
import { openKeptPanel, wireMapPanels, wirePage } from './panels/wiring.ts';

const RESULTS_HTML =
    '<div class="strip"></div>' +
    '<div class="rlist">' +
    '<div class="rh" id="pgCount"></div>' +
    '<div class="fc" id="pgChips"></div>' +
    '<div class="rows" id="pgRows"></div>' +
    '</div>';

// the example's banner: what the page is for, where the saves are and the open button
function bannerHtml(model: ProgressModel): string {
    if (!model.demo) return '';

    const text =
        '<span class="bt">See which level to play next, without spoilers. Your save stays on this computer.</span>';
    const path = `<code id="bnPath">${escapeHtml(SAVE_PATH)}</code>`;
    const copyButton = '<button id="bnCopy" title="Copy the folder path">Copy path</button>';
    const openButton = `<button class="primary" id="bnOpen">${folderLabel()}</button>`;
    return `<div class="banner">${text}${path}${copyButton}${openButton}</div>`;
}

// the map with the goal's markers and overlays, and the panel of each node kind
function startMap(context: PanelContext): void {
    const progress = context.progress;
    context.overlays = () => overlaysOf(context);

    let fog: Fog | null = null;
    if (context.hide) fog = context.fog;
    const options: MapOptions = {
        markers: levelMarkers(context),
        towers: towerMarkers(context),
        labels: areaLabels(context),
        hero: context.model.hero,
        style: (marker) => markerStyle(context, marker),
        key: keyHtml(context),
        fog,
        reach: progress.reach?.cols,
        overlays: context.overlays(),
        keep: (overlay) => markerShown(overlay, context.filters.states.includes('solved')),
        water: oceanWater(progress.lt),
        onLayer: (layerKey) => layerChanged(context, layerKey),
        onClose: () => {
            markSelected(context, null);
            context.current = null;
            context.back.length = 0;
            delete panelKeep[context.camp];
            setHash('');
        },
    };

    context.mapOptions = options;
    context.map = mapInit('pgMap', options);
    context.selectors.level = (levelIndex, how) => showLevelPanel(context, levelIndex, how);
    context.selectors.tower = (towerIndex, how) => showTowerPanel(context, towerIndex, how);
    context.selectors.gate = (freezerIndex, how) => showGatePanel(context, freezerIndex, how);
    context.selectors.sign = (signIndex, how) => showSignPanel(context, signIndex, how);
    wireMapPanels(context);
}

export function renderProgress(model: ProgressModel): void {
    const context = new PanelContext(model);
    const { progress, filters } = context;

    // a tower or area under fog is no filter
    if (filters.tower !== '' && progress.towerHidden[Number(filters.tower)]) filters.tower = '';
    if (filters.area !== '' && !model.areaShown(Number(filters.area))) filters.area = '';

    let mapFog: Fog | null = null;
    if (context.hide) mapFog = context.fog;
    $('#banner').innerHTML = bannerHtml(model);
    $('#main').innerHTML = PROG.map ? mapHtml('pgMap', mapFog, !!progress.reach) : '';
    $('#results').innerHTML = RESULTS_HTML;
    $('#bnOpen')?.addEventListener('click', () => void folderAction());
    $('#bnCopy')?.addEventListener('click', (event) => void copyPath(event));
    context.loadGoal();
    context.computeMatches();
    if (PROG.map) context.mapLayer = startLayer(mapKeep('pgMap'), mapFog);
    hooks.apply = (redraw) => applyFilters(context, redraw);
    if (PROG.map) startMap(context);
    wirePage(context);
    if (context.map) context.mapLayer = context.map.layer;
    applyFilters(context);
    refreshSideAreas();
    openKeptPanel(context);
}
