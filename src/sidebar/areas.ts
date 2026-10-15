// The sidebar's area list: the areas by layer with their solved counts, the map's layer first and open
// (VIEWER.md "The page (viewer)", "Level areas (viewer)")
import { PROG } from '../data.ts';
import { escapeHtml } from '../util.ts';
import { readPreference, setPreference } from '../shared.ts';
import { progressBarHtml } from '../format.ts';
import { checkIcon } from '../map/icons.ts';
import { viewLayer } from '../map/map-html.ts';
import { areaName } from '../model/areas.ts';
import { AREA_LAYERS, layerName } from '../model/layers.ts';
import type { ProgressModel } from '../model/progress-model.ts';
import type { Area } from '../types.ts';

/** The levels of an area that are not under fog, and how many of them are solved. */
interface AreaCount {
    all: number;
    solved: number;
}

// layer groups of the area list that were opened by hand (the map's layer is always open)
const groupsOpen = new Set<string>();

// whether the area list is open, and the finished areas under each layer's open ones
let areasOpen = readPreference('areasOpen') === '1';

let finishedOpen = readPreference('finishedOpen') === '1';

// the mark of a section that is open or closed
const chevronOf = (open: boolean): string => {
    if (open) return '▾';
    return '▸';
};

export const areaListOpen = (): boolean => areasOpen;

export function toggleAreaList(): void {
    areasOpen = !areasOpen;
    setPreference('areasOpen', areasOpen ? '1' : '0');
}

export function toggleLayerGroup(groupKey: string): void {
    if (groupsOpen.has(groupKey)) groupsOpen.delete(groupKey);
    else groupsOpen.add(groupKey);
}

export function toggleFinished(): void {
    finishedOpen = !finishedOpen;
    setPreference('finishedOpen', finishedOpen ? '1' : '0');
}

// the map's layer first, then the others in their order
function layerFirst(layerKeys: string[]): string[] {
    const mapLayer = viewLayer();
    if (!mapLayer || !layerKeys.includes(mapLayer)) return layerKeys;
    return [mapLayer, ...layerKeys.filter((key) => key !== mapLayer)];
}

// a layer's header, a button that opens and closes it unless it is the map's layer; its rows follow while open
function layerGroupHtml(layerKey: string, count: string, inner: string): string {
    const mapLayer = viewLayer();
    const fixed = !mapLayer || layerKey === mapLayer;
    const groupKey = 'areas:' + layerKey;
    const open = fixed || groupsOpen.has(groupKey);
    let toggle = '';
    let chevron = '';
    if (!fixed) {
        toggle = ` data-grp="${groupKey}" role="button" tabindex="0" aria-expanded="${open}"`;
        chevron = `<i class="chev" aria-hidden="true">${chevronOf(open)}</i>`;
    }

    const name = escapeHtml(layerName(layerKey));
    const nameHtml = `<span class="gn">${name}</span>`;
    const countHtml = `<span class="cnt">${count}${chevron}</span>`;
    const header = `<div class="lh"${toggle}>${nameHtml}${countHtml}</div>`;
    if (!open) return header;
    return header + inner;
}

// per area, its levels not under fog and how many of them are solved
function areaCounts(model: ProgressModel, areas: Area[]): AreaCount[] {
    const counts = areas.map((): AreaCount => ({ all: 0, solved: 0 }));
    model.levels.forEach((_level, levelIndex) => {
        const area = model.levelArea[levelIndex];
        if (area == null || model.progress.hidden[levelIndex]) return;

        counts[area].all++;
        if (model.progress.state[levelIndex] === 'solved') counts[area].solved++;
    });

    return counts;
}

const layerOfArea = (area: Area): string => area.layer || 'ground';

export function sideAreasHtml(model: ProgressModel): string {
    const areas = PROG.areas || [];
    if (!areas.length) return '';

    const counts = areaCounts(model, areas);
    const finished = (areaIndex: number): boolean => counts[areaIndex].solved === counts[areaIndex].all;
    const listed = [...areas.keys()]
        .filter((areaIndex) => counts[areaIndex].all && model.areaShown(areaIndex))
        .toSorted((first, second) => (areas[first].order ?? 1e9) - (areas[second].order ?? 1e9));
    const finishedTotal = `${listed.filter(finished).length} / ${listed.length}`;
    const headChevron = `<i class="chev" aria-hidden="true">${chevronOf(areasOpen)}</i>`;
    const count = `<span class="cnt" title="Areas with every level solved">${finishedTotal}${headChevron}</span>`;
    const headContent = `<span class="sh">Areas</span>${count}`;
    const head = `<button class="plain ah" data-areas aria-expanded="${areasOpen}">${headContent}</button>`;
    if (!areasOpen) return head;

    const listedLayers = new Set(listed.map((areaIndex) => layerOfArea(areas[areaIndex])));
    const extraLayers = [...listedLayers].filter((key) => !AREA_LAYERS.includes(key));
    const layers = layerFirst(AREA_LAYERS.concat(extraLayers));

    // with one layer listed, the panel's own header already gives its count
    const grouped = listedLayers.size > 1;
    const rowHtml = (areaIndex: number): string => {
        const done = finished(areaIndex);
        const { solved, all } = counts[areaIndex];
        const name = escapeHtml(areaName(areas[areaIndex]));
        let doneClass = '';
        let check = '';
        let progressBar = '';
        if (done) {
            doneClass = ' done';
            check = `<span title="All levels solved">${checkIcon}</span>`;
        } else {
            progressBar = progressBarHtml(solved, all);
        }

        const attributes = `data-area="${areaIndex}" aria-pressed="false" title="${name}"`;
        const nameHtml = `<span class="n">${name}</span>`;
        const countHtml = `<span class="cnt">${check}${solved} / ${all}</span>`;
        return `<button class="plain${doneClass}" ${attributes}>${nameHtml}${countHtml}${progressBar}</button>`;
    };

    // finished areas fold into one row under the open ones
    const finishedRowHtml = (layerKey: string, finishedCount: number): string => {
        const attributes = `data-fin="${layerKey}" role="button" tabindex="0" aria-expanded="${finishedOpen}"`;
        const chevron = `<i class="chev" aria-hidden="true">${chevronOf(finishedOpen)}</i>`;
        const title = 'title="Areas with every level solved"';
        return `<div class="fin" ${attributes} ${title}><span>${finishedCount} finished</span>${chevron}</div>`;
    };

    const layerHtml = (layerKey: string): string => {
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
