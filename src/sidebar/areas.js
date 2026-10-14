// The sidebar's area list: the areas by layer with their solved counts, the map's layer first and open
// (VIEWER.md "The page (viewer)", "Level areas (viewer)")
import { PROG } from '../data.js';
import { esc } from '../util.js';
import { pref, setPref } from '../shared.js';
import { bar } from '../format.js';
import { AREA_LAYERS, layerName } from '../model/layers.js';
import { checkIcon } from '../map/icons.js';
import { viewLayer } from '../map/map-html.js';

// layer groups of the area list that were opened by hand (the map's layer is always open)
const groupsOpen = new Set();
// whether the area list is open, and the finished areas under each layer's open ones
let areasOpen = pref('areasOpen') === '1';
let finishedOpen = pref('finishedOpen') === '1';

export const areaName = (area) => area.display || area.local_area_name;
export const areaListOpen = () => areasOpen;
export function toggleAreaList() {
    areasOpen = !areasOpen;
    setPref('areasOpen', areasOpen ? '1' : '0');
}
export function toggleLayerGroup(groupKey) {
    if (groupsOpen.has(groupKey)) groupsOpen.delete(groupKey);
    else groupsOpen.add(groupKey);
}
export function toggleFinished() {
    finishedOpen = !finishedOpen;
    setPref('finishedOpen', finishedOpen ? '1' : '0');
}

// the map's layer first, then the others in their order
function layerFirst(layerKeys) {
    const mapLayer = viewLayer();
    if (!mapLayer || !layerKeys.includes(mapLayer)) return layerKeys;
    return [mapLayer, ...layerKeys.filter((key) => key !== mapLayer)];
}
// a layer's header, a button that opens and closes it unless it is the map's layer; its rows follow while open
function layerGroupHtml(layerKey, count, inner) {
    const mapLayer = viewLayer();
    const fixed = !mapLayer || layerKey === mapLayer;
    const groupKey = 'areas:' + layerKey;
    const open = fixed || groupsOpen.has(groupKey);
    let toggle = '';
    let chevron = '';
    if (!fixed) {
        toggle = ` data-grp="${groupKey}" role="button" tabindex="0" aria-expanded="${open}"`;
        chevron = `<i class="chev" aria-hidden="true">${open ? '▾' : '▸'}</i>`;
    }
    const header = `<div class="lh"${toggle}><span class="gn">${esc(layerName(layerKey))}</span><span class="cnt">${count}${chevron}</span></div>`;
    if (!open) return header;
    return header + inner;
}
// per area, its levels not under fog and how many of them are solved
function areaCounts(model, areas) {
    const counts = areas.map(() => ({ all: 0, solved: 0 }));
    model.levels.forEach((level, i) => {
        const area = model.levelArea[i];
        if (area == null || model.progress.hidden[i]) return;
        counts[area].all++;
        if (model.progress.state[i] === 'solved') counts[area].solved++;
    });
    return counts;
}
const layerOfArea = (area) => area.layer || 'ground';

export function sideAreasHtml(model) {
    const areas = PROG.areas || [];
    if (!areas.length) return '';
    const counts = areaCounts(model, areas);
    const finished = (areaIndex) => counts[areaIndex].solved === counts[areaIndex].all;
    const listed = areas
        .map((area, areaIndex) => areaIndex)
        .filter((areaIndex) => counts[areaIndex].all && model.areaShown(areaIndex))
        .toSorted((a, b) => (areas[a].order ?? 1e9) - (areas[b].order ?? 1e9));
    const head = `<button class="plain ah" data-areas aria-expanded="${areasOpen}"><span class="sh">Areas</span><span class="cnt" title="Areas with every level solved">${listed.filter(finished).length} / ${listed.length}<i class="chev" aria-hidden="true">${areasOpen ? '▾' : '▸'}</i></span></button>`;
    if (!areasOpen) return head;
    const listedLayers = new Set(listed.map((areaIndex) => layerOfArea(areas[areaIndex])));
    const extraLayers = [...listedLayers].filter((key) => !AREA_LAYERS.includes(key));
    const layers = layerFirst(AREA_LAYERS.concat(extraLayers));
    // with one layer listed, the panel's own header already gives its count
    const grouped = listedLayers.size > 1;
    const rowHtml = (areaIndex) => {
        const done = finished(areaIndex);
        const { solved, all } = counts[areaIndex];
        const name = esc(areaName(areas[areaIndex]));
        let check = '';
        if (done) check = `<span title="All levels solved">${checkIcon}</span>`;
        let progressBar = '';
        if (!done) progressBar = bar(solved, all);
        return `<button class="plain${done ? ' done' : ''}" data-area="${areaIndex}" aria-pressed="false" title="${name}"><span class="n">${name}</span><span class="cnt">${check}${solved} / ${all}</span>${progressBar}</button>`;
    };
    // finished areas fold into one row under the open ones
    const finishedRowHtml = (layerKey, count) =>
        `<div class="fin" data-fin="${layerKey}" role="button" tabindex="0" aria-expanded="${finishedOpen}" title="Areas with every level solved"><span>${count} finished</span><i class="chev" aria-hidden="true">${finishedOpen ? '▾' : '▸'}</i></div>`;
    const layerHtml = (layerKey) => {
        const inLayer = listed.filter((areaIndex) => layerOfArea(areas[areaIndex]) === layerKey);
        if (!inLayer.length) return '';
        const done = inLayer.filter(finished);
        let rows = inLayer
            .filter((areaIndex) => !finished(areaIndex))
            .map(rowHtml)
            .join('');
        if (done.length) {
            rows += finishedRowHtml(layerKey, done.length);
            if (finishedOpen) rows += done.map(rowHtml).join('');
        }
        if (!grouped) return rows;
        return layerGroupHtml(layerKey, `${done.length} / ${inLayer.length}`, rows);
    };
    return head + layers.map(layerHtml).join('');
}
