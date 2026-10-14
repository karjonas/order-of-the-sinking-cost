// The map's markup before it is drawn (VIEWER.md "The page (viewer)"): the layer images, the fog and hatch groups, the
// repeated copies, the layer, overlay and zoom controls; the overlay switches and the view kept per campaign
import { PROG } from '../data.js';
import { esc } from '../util.js';
import { pref, state } from '../shared.js';
import { ZOOM_STEP } from '../panzoom.js';
import { AREA_LAYERS } from '../model/layers.js';
import { HERO_PATH, ICON_STROKE, OV_ICONS, svgIcon } from './icons.js';
import { wrapCopies } from './torus.js';

const WATER_RGB = [51, 104, 139];
// map overlays the viewer can switch off, remembered per browser; treasure plinths and map scrolls are always drawn
const OVERLAYS = [
    ['gates', 'Gates', 'Ice gates and the signs that open them'],
    ['tps', 'Teleporters', 'Teleporters and gold rooms'],
    ['logs', 'Logs', 'Voice logs'],
    ['reach', 'Reachable', 'Where the walk model says you can go from where you have been (approximate)'],
];
export const overlayOn = { gates: true, tps: true, logs: true, reach: true };
try {
    const saved = JSON.parse(pref('mapOverlays') || '{}');
    for (const kind of Object.keys(overlayOn)) if (typeof saved[kind] === 'boolean') overlayOn[kind] = saved[kind];
} catch {}

// the terrain group: the base images, the changed water, the Reachable images and the fog, clipped to the map
function terrainHtml(id, layers, reach) {
    const [width, height] = PROG.map.size,
        water = (PROG.map.water_rgb || WATER_RGB).join(',');
    const images = layers
        .map((layer) => `<image data-layer="${layer.key}" x="0" y="0" width="${width}" height="${height}"/>`)
        .join('');
    let reachImages = '',
        hatch = '';
    if (reach) {
        reachImages = layers
            .map(
                (layer) =>
                    `<image class="reach" data-layer="${layer.key}" x="0" y="0" width="${width}" height="${height}" style="display:none"/>`,
            )
            .join('');
        hatch = `<pattern id="${id}-hatch" class="hatch" patternUnits="userSpaceOnUse" width="1" height="1" patternTransform="rotate(45)"><rect width="0.2" height="1"/></pattern>`;
    }
    const cloud = `<filter id="${id}-cloud" filterUnits="userSpaceOnUse" x="${-2 * width}" y="${-2 * height}" width="${5 * width}" height="${5 * height}"><feGaussianBlur stdDeviation="2.2"/></filter>`;
    const fog = `<clipPath id="${id}-clip"><rect x="0" y="0" width="${width}" height="${height}"/></clipPath><g clip-path="url(#${id}-clip)"><g class="fog" filter="url(#${id}-cloud)" style="stroke: var(--fog)"></g><g class="fogc"></g><g class="rfog" fill="url(#${id}-hatch)"></g></g>`;
    return `<g id="${id}-w" class="mw">${images}<g class="wtr" fill="rgb(${water})" shape-rendering="crispEdges"></g>${reachImages}<defs>${cloud}${hatch}</defs>${fog}</g>`;
}
// the layer buttons in area order, the overlay switches and the hero and zoom buttons
function controlsHtml(layers) {
    const layerButtons = layers
        .toSorted((a, b) => AREA_LAYERS.indexOf(a.key) - AREA_LAYERS.indexOf(b.key))
        .map((layer) => `<button data-layer="${layer.key}">${esc(layer.name)}</button>`)
        .join('');
    const overlayButtons = OVERLAYS.map(
        ([kind, label, title]) =>
            `<button data-ov="${kind}" title="${esc(title)}">${OV_ICONS[kind]}${esc(label)}</button>`,
    ).join('');
    const hero = `<button data-hero title="Show the hero" aria-label="Show the hero">${svgIcon(HERO_PATH, '#fff', ICON_STROKE)}</button>`;
    const zoom = `<button data-z="${1 / ZOOM_STEP}" title="Zoom in">+</button><button data-z="${ZOOM_STEP}" title="Zoom out">−</button>`;
    const layersHidden = layers.length < 2 ? ' hidden' : '';
    return `<div class="ctl"><span class="seg" data-role="layers"${layersHidden}>${layerButtons}</span><span class="seg ovl" data-role="ovl" hidden>${overlayButtons}</span><span class="seg zoom">${hero}${zoom}</span></div>`;
}
// fog: the fog to bake into the images; layers it has not uncovered get no image and no button
// reach: whether to include the Reachable overlay images (hidden until mapInit gets the bitmaps in opts.reach)
export function mapHtml(id, fog, reach) {
    const [width, height] = PROG.map.size,
        known = knownLayers(fog),
        layers = PROG.map.layers.filter((layer) => !known || known.includes(layer.key));
    const svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${terrainHtml(id, layers, reach)}${wrapCopies(id, 'w', width, height)}<g id="${id}-o" class="mw"><g class="ov"></g></g>${wrapCopies(id, 'o', width, height)}<g class="mw lbl"></g></svg>`;
    return `<div class="mapbox" id="${id}">${svg}\n    ${controlsHtml(layers)}\n    <div class="key"></div><div class="sel"></div><div class="tip"></div></div>`;
}
// the view and layer of each map, by map id
export const mapViews = {};
// the view and layer survive redraws of one campaign's map; another campaign starts fresh
export function mapKeep(id) {
    const keep = (mapViews[id] ||= {});
    if (keep.camp !== state.camp) {
        for (const key of Object.keys(keep)) delete keep[key];
        keep.camp = state.camp;
    }
    return keep;
}
// with fog shown, the map layers the player has uncovered (ground before any); null without fog
export function knownLayers(fog) {
    if (!fog) return null;
    const known = fog.knownLayers();
    if (known.length) return known;
    return ['ground'];
}
// the layer a map opens on: the remembered one, else ground, and with fog shown one the player has uncovered
export function startLayer(keep, fog) {
    const known = knownLayers(fog),
        layer = keep.layer || 'ground';
    if (known && !known.includes(layer)) return known[0];
    return layer;
}
// the layer the progress map shows for the current campaign, null before it is drawn
export function viewLayer() {
    if (mapViews.pgMap?.camp !== state.camp) return null;
    return mapViews.pgMap.layer || null;
}
