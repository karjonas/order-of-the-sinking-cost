// The map's markup before it is drawn (VIEWER.md "The page (viewer)"): the layer images, the fog and hatch groups, the
// repeated copies, the layer, overlay and zoom controls; the overlay switches and the view kept per campaign
import { PROG } from '../data.ts';
import type { Fog } from '../fog.ts';
import { capitalized, freezersNoun } from '../model/freezer-names.ts';
import { AREA_LAYERS } from '../model/layers.ts';
import { ZOOM_STEP } from '../panzoom.ts';
import type { PanZoomKeep } from '../panzoom.ts';
import { readPreference, state } from '../shared.ts';
import type { MapLayer } from '../types.ts';
import { escapeHtml } from '../util.ts';
import { HERO_PATH, ICON_STROKE, OVERLAY_ICONS, svgIcon } from './icons.ts';
import { wrapCopies } from './torus.ts';

/** The overlays of the map that the viewer can switch off. */
export type OverlayKind = 'gates' | 'tps' | 'logs' | 'reach';

/** What survives a redraw of one map: its view, the layer shown and the campaign it was for. */
export interface MapKeep extends PanZoomKeep {
    camp?: string | null;
    layer?: string;
}

const WATER_RGB = [51, 104, 139];

const EVERY_FREEZER = capitalized(freezersNoun(PROG.freezers.map((_freezer, index) => index)));

// map overlays the viewer can switch off, remembered per browser; treasure plinths and map scrolls are always drawn
const OVERLAYS: Array<[kind: OverlayKind, label: string, title: string]> = [
    ['gates', 'Ice', `${EVERY_FREEZER}, and the signs that open them`],
    ['tps', 'Teleporters', 'Teleporters, and the Antipode teleporters'],
    ['logs', 'Logs', 'Voice logs'],
    ['reach', 'Reachable', 'Where the walk model says you can go from where you have been (approximate)'],
];

const OVERLAY_KINDS: OverlayKind[] = ['gates', 'tps', 'logs', 'reach'];
export const overlayOn: Record<OverlayKind, boolean> = { gates: true, tps: true, logs: true, reach: true };
export const isOverlayKind = (kind: string): kind is OverlayKind => kind in overlayOn;

try {
    const saved: Partial<Record<OverlayKind, unknown>> = JSON.parse(readPreference('mapOverlays') || '{}');
    for (const kind of OVERLAY_KINDS) {
        const value = saved[kind];
        if (typeof value === 'boolean') overlayOn[kind] = value;
    }
} catch {}

// the terrain group: the base images, the changed water, the Reachable images and the fog, clipped to the map
function terrainHtml(id: string, layers: MapLayer[], reach: boolean): string {
    const [width, height] = PROG.map.size;
    const water = (PROG.map.water_rgb || WATER_RGB).join(',');
    const size = `width="${width}" height="${height}"`;
    const images = layers.map((layer) => `<image data-layer="${layer.key}" x="0" y="0" ${size}/>`).join('');

    let reachImages = '';
    let hatch = '';
    if (reach) {
        reachImages = layers
            .map((layer) => `<image class="reach" data-layer="${layer.key}" x="0" y="0" ${size} style="display:none"/>`)
            .join('');
        const hatchAttributes = [
            'class="hatch"',
            'patternUnits="userSpaceOnUse"',
            'width="1" height="1"',
            'patternTransform="rotate(45)"',
        ].join(' ');
        hatch = `<pattern id="${id}-hatch" ${hatchAttributes}><rect width="0.2" height="1"/></pattern>`;
    }

    const cloudBox = `x="${-2 * width}" y="${-2 * height}" width="${5 * width}" height="${5 * height}"`;
    const blur = '<feGaussianBlur stdDeviation="2.2"/>';
    const cloud = `<filter id="${id}-cloud" filterUnits="userSpaceOnUse" ${cloudBox}>${blur}</filter>`;
    const clip = `<clipPath id="${id}-clip"><rect x="0" y="0" ${size}/></clipPath>`;
    const cloudGroup = `<g class="fog" filter="url(#${id}-cloud)" style="stroke: var(--fog)"></g>`;
    const fogGroups = `${cloudGroup}<g class="fogc"></g><g class="rfog" fill="url(#${id}-hatch)"></g>`;
    const fog = `${clip}<g clip-path="url(#${id}-clip)">${fogGroups}</g>`;
    const waterGroup = `<g class="wtr" fill="rgb(${water})" shape-rendering="crispEdges"></g>`;
    return `<g id="${id}-w" class="mw">${images}${waterGroup}${reachImages}<defs>${cloud}${hatch}</defs>${fog}</g>`;
}

// the layer buttons in area order, the overlay switches and the hero and zoom buttons
function controlsHtml(layers: MapLayer[]): string {
    const layerButtons = layers
        .toSorted((first, second) => AREA_LAYERS.indexOf(first.key) - AREA_LAYERS.indexOf(second.key))
        .map((layer) => `<button data-layer="${layer.key}">${escapeHtml(layer.name)}</button>`)
        .join('');
    const overlayButtons = OVERLAYS.map(([kind, label, title]) => {
        const icon = OVERLAY_ICONS[kind];
        return `<button data-ov="${kind}" title="${escapeHtml(title)}">${icon}${escapeHtml(label)}</button>`;
    }).join('');
    const heroIcon = svgIcon(HERO_PATH, '#fff', ICON_STROKE);
    const hero = `<button data-hero title="Show the hero" aria-label="Show the hero">${heroIcon}</button>`;
    const zoomIn = `<button data-z="${1 / ZOOM_STEP}" title="Zoom in">+</button>`;
    const zoomOut = `<button data-z="${ZOOM_STEP}" title="Zoom out">−</button>`;
    const layersHidden = layers.length < 2 ? ' hidden' : '';

    const layerGroup = `<span class="seg" data-role="layers"${layersHidden}>${layerButtons}</span>`;
    const overlayGroup = `<span class="seg ovl" data-role="ovl" hidden>${overlayButtons}</span>`;
    const zoomGroup = `<span class="seg zoom">${hero}${zoomIn}${zoomOut}</span>`;
    return `<div class="ctl">${layerGroup}${overlayGroup}${zoomGroup}</div>`;
}

/**
 * The markup of the map `id`. `fog`: the fog to bake into the images; layers it has not uncovered get no image and no
 * button. `reach`: whether to include the Reachable overlay images (hidden until mapInit gets the bitmaps in
 * opts.reach).
 */
export function mapHtml(id: string, fog: Fog | null | undefined, reach: boolean): string {
    const [width, height] = PROG.map.size;
    const known = knownLayers(fog);
    const layers = PROG.map.layers.filter((layer) => !known || known.includes(layer.key));

    const terrain = `${terrainHtml(id, layers, reach)}${wrapCopies(id, 'w', width, height)}`;
    const overlay = `<g id="${id}-o" class="mw"><g class="ov"></g></g>${wrapCopies(id, 'o', width, height)}`;
    const svgOpen = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">`;
    const svg = `${svgOpen}${terrain}${overlay}<g class="mw lbl"></g></svg>`;

    const readouts = '<div class="key"></div><div class="sel"></div><div class="tip"></div>';
    return `<div class="mapbox" id="${id}">${svg}\n    ${controlsHtml(layers)}\n    ${readouts}</div>`;
}

/** The view and layer of each map, by map id. */
export const mapViews: Record<string, MapKeep> = {};

/** The view and layer survive redraws of one campaign's map; another campaign starts fresh. */
export function mapKeep(id: string): MapKeep {
    let keep = mapViews[id];
    if (!keep) {
        keep = {};
        mapViews[id] = keep;
    }

    if (keep.camp !== state.camp) {
        delete keep.vb;
        delete keep.moved;
        delete keep.layer;
        keep.camp = state.camp;
    }

    return keep;
}

/** With fog shown, the map layers the player has uncovered (ground before any); null without fog. */
export function knownLayers(fog: Fog | null | undefined): string[] | null {
    if (!fog) return null;

    const known = fog.knownLayers();
    if (known.length) return known;
    return ['ground'];
}

/** The layer a map opens on: the remembered one, else ground, and with fog shown one the player has uncovered. */
export function startLayer(keep: MapKeep, fog: Fog | null | undefined): string {
    const known = knownLayers(fog);
    const layer = keep.layer || 'ground';
    if (known && !known.includes(layer)) return known[0];
    return layer;
}

/** The layer the progress map shows for the current campaign, null before it is drawn. */
export function viewLayer(): string | null {
    if (mapViews.pgMap?.camp !== state.camp) return null;
    return mapViews.pgMap.layer || null;
}
