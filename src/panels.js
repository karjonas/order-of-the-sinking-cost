// The progress view: the results list, the map and its panels (VIEWER.md "The page (viewer)")
import { PROG } from './data.js';
import { $, esc } from './util.js';
import { hooks } from './shared.js';
import { SAVE_PATH } from './files.js';
import { mapHtml, mapKeep, startLayer } from './map/map-html.js';
import { mapInit } from './map/map-view.js';
import { oceanWater } from './map/layer-image.js';
import { refreshSideAreas } from './sidebar.js';
import { copyPath, folderAction, folderLabel } from './folder.js';
import { PanelContext } from './panels/context.js';
import { panelKeep, setHash } from './panels/hash.js';
import { apply, layerChanged, markSelected } from './panels/list.js';
import {
    areaLabels,
    keyHtml,
    levelMarkers,
    markerShown,
    markerStyle,
    overlaysOf,
    towerMarkers,
} from './panels/markers.js';
import { showLevelPanel } from './panels/level-panel.js';
import { showTowerPanel } from './panels/tower-panel.js';
import { showGatePanel } from './panels/gate-panel.js';
import { showSignPanel } from './panels/sign-panel.js';
import { openKeptPanel, wireMapPanels, wirePage } from './panels/wiring.js';

const RESULTS_HTML =
    '<div class="strip"></div><div class="rlist"><div class="rh" id="pgCount"></div><div class="fc" id="pgChips"></div><div class="rows" id="pgRows"></div></div>';

// the example's banner: what the page is for, where the saves are and the open button
function bannerHtml(model) {
    if (!model.demo) return '';
    return `<div class="banner"><span class="bt">See which level to play next, without spoilers. Your save stays on this computer.</span><code id="bnPath">${esc(SAVE_PATH)}</code><button id="bnCopy" title="Copy the folder path">Copy path</button><button class="primary" id="bnOpen">${folderLabel()}</button></div>`;
}

// the map with the goal's markers and overlays, and the panel of each node kind
function startMap(context) {
    const progress = context.progress;
    context.overlays = () => overlaysOf(context);
    context.mapOptions = {
        markers: levelMarkers(context),
        towers: towerMarkers(context),
        labels: areaLabels(context),
        hero: context.model.hero,
        style: (marker) => markerStyle(context, marker),
        key: keyHtml(context),
        fog: context.hide ? context.fog : null,
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
    context.map = mapInit('pgMap', context.mapOptions);
    context.selectors.level = (i, how) => showLevelPanel(context, i, how);
    context.selectors.tower = (ti, how) => showTowerPanel(context, ti, how);
    context.selectors.gate = (fi, how) => showGatePanel(context, fi, how);
    context.selectors.sign = (si, how) => showSignPanel(context, si, how);
    wireMapPanels(context);
}

export function renderProgress(model) {
    const context = new PanelContext(model);
    const { progress, filters } = context;
    // a tower or area under fog is no filter
    if (filters.tower !== '' && progress.towerHidden[filters.tower]) filters.tower = '';
    if (filters.area !== '' && !model.areaShown(filters.area)) filters.area = '';
    const mapFog = context.hide ? context.fog : null;
    $('#banner').innerHTML = bannerHtml(model);
    $('#main').innerHTML = PROG.map ? mapHtml('pgMap', mapFog, !!progress.reach) : '';
    $('#results').innerHTML = RESULTS_HTML;
    $('#bnOpen')?.addEventListener('click', folderAction);
    $('#bnCopy')?.addEventListener('click', copyPath);
    context.loadGoal();
    context.computeMatches();
    if (PROG.map) context.mapLayer = startLayer(mapKeep('pgMap'), mapFog);
    hooks.apply = (redraw) => apply(context, redraw);
    if (PROG.map) startMap(context);
    wirePage(context);
    if (context.map) context.mapLayer = context.map.layer;
    apply(context);
    refreshSideAreas();
    openKeptPanel(context);
}
