// The overworld map of the progress view (VIEWER.md "The page (viewer)"): one layer's base image under the fog, the
// Reachable overlay, the overlay marks, the level and tower markers with the selection's links and steps, the area
// labels, the selection panel, the key and the tooltip, over panZoom's view of the wrapping map
import { PROG } from '../data.js';
import { $, esc, segOn } from '../util.js';
import { setPref } from '../shared.js';
import { panZoom } from '../panzoom.js';
import { AREA_LAYERS, mapLayerOf, wrapDelta } from '../model/layers.js';
import { ACH_BADGE, HERO_PATH, OV_PAD, SHAPES, STAR, STAR_BIG } from './icons.js';
import { mapXY, rawXY, torusBox, wrapRect } from './torus.js';
import { mapLayerImage } from './layer-image.js';
import { reachedRects, reachImage } from './reach-image.js';
import { knownLayers, mapKeep, overlayOn, startLayer } from './map-html.js';

// the map drawn last
export let activeMap = null;
// told when a drag, pinch or eased zoom of a map ends
let gestureEndListener = null;
export function onGestureEnd(listener) {
    gestureEndListener = listener;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// the elements a pointer event can be on, found by geometry in the copies of the map
const INTERACTIVE = '[data-i],[data-tw],[data-gate],[data-sign],[data-gtw],[data-tip]';
// the smallest box a selection or a set of points is framed in, in squares; an unlock chain's steps get a closer one
const MIN_BOX = 24,
    MIN_CHAIN_BOX = 8;
// the margin around a framed box, in pixels
const FRAME_MARGIN = 28;

const overlaid = (element) => getComputedStyle(element).position === 'absolute';
// world rectangle [x, y, w, h] to map coordinates
function toMap([x, y, width, height]) {
    const [mapX, mapY] = rawXY(x, y + height);
    return [mapX - 0.5, mapY + 0.5, width, height];
}
const rectHtml = (x, y, width, height, grow) =>
    `<rect x="${x - grow}" y="${y - grow}" width="${width + 2 * grow}" height="${height + 2 * grow}"/>`;
// the screen position of a mark, which its transform reads
const placedAt = (x, y) => `style="--x:${x.toFixed(2)}px;--y:${y.toFixed(2)}px"`;
const boxOf = (points) => torusBox(points.map((point) => [point[0], point[1], 0, 0]));
function padBox(box, min = MIN_BOX) {
    const width = Math.max(box.w, min),
        height = Math.max(box.h, min);
    return { x: box.x - (width - box.w) / 2, y: box.y - (height - box.h) / 2, w: width, h: height };
}
const greatestCommonDivisor = (a, b) => (b ? greatestCommonDivisor(b, a % b) : a);
const mapLayer = (key) => PROG.map.layers.find((layer) => layer.key === key);
// a level marker's path radius: larger for the focused level and for big markers
function levelMarkerRadius(style, focused) {
    if (focused) return 8;
    if (style.big) return 7;
    return 5;
}
// an end of a link: a marker index, or an [x, y, z] position (a tower)
const isPosition = (end) => Array.isArray(end);

// opts: { markers: [{i, x, y, z, tip, ice: {id (the overlay id of the ice gate on its entrance), open}}], style(mk) -> {color, hidden, gone, star, shape, ring, big}, towers: [{i, x, y, z, on, tip}],
//   labels, hero: {x, y, z}, fog (shown and framed as the home view when given), key, onClose(),
//   keep(overlay) -> whether the list filter keeps an overlay (the selection's overlays are drawn whatever it says), reach: {layer key: column bitmap of the reached squares} (the Reachable overlay; without it the toggle is hidden),
//   overlays: [{kind (an OVERLAYS key, or treasures / maps: always drawn), layer (map layer key), x, y, cls, d (path in screen pixels), tip, id, done (false: not done yet), attr (data attributes that make it clickable), merge (marker index whose backing square replaces it while that marker is drawn)}], onLayer(key), water: {layer key: [[x, y]]} }
// The caller sets onPick(level), onTower(i), onGate(i) and onSign(i) for clicks on the map.
class MapView {
    constructor(id, opts) {
        this.opts = opts;
        this.box = $('#' + id);
        this.svg = this.box.querySelector('svg');
        this.overlayGroup = this.svg.querySelector('.ov');
        this.tip = this.box.querySelector('.tip');
        this.panel = this.box.querySelector('.sel');
        this.controls = this.box.querySelector('.ctl');
        this.keyBox = this.box.querySelector('.key');
        this.keep = mapKeep(id);
        this.keyShown = false;
        this.layoutFrame = 0;
        this.currentLayer = startLayer(this.keep, opts.fog);
        // the selection: {levels, tower, focus, frontier, ov, links, steps, ...} (see select), or null
        this.selection = null;
        // the level markers of the last draw, for the tooltip of overlapping ones
        this.drawnMarkers = [];
        this.linkEnds = [];
        this.fogOn = !!opts.fog;
        // with fog shown, layers the player has not uncovered yet have no button (mapHtml leaves them out)
        this.known = knownLayers(opts.fog);
        // a layer that cannot be kept (no longer uncovered) starts from the home view
        if (this.currentLayer !== this.keep.layer) delete this.keep.vb;
        this.keep.layer = this.currentLayer;
        // undefined until the home box is worked out for the current draw
        this.homeCache = undefined;
        this.hitList = null;
        this.hover = null;
        this.tipHtml = '';
        // the lines, labels, fog edge and hatch follow the view; linkElements: the elements of the last draw
        this.linkElements = [];
        // The area labels sit outside the repeated overlay group: each copy of the map has a text element of its own,
        // made the first time the view puts that copy's label in the free area. labels: {text, x, y, w (box width in
        // pixels at the smallest label size)} of the last draw; labelPool: the text elements by label and copy;
        // labelsOn: the ones shown
        this.labelsGroup = this.svg.querySelector('g.lbl');
        this.labelPool = new Map();
        this.labels = [];
        this.labelsOn = new Set();
        this.fogGroup = this.svg.querySelector('.fog');
        this.fogCore = this.svg.querySelector('.fogc');
        this.blur = this.svg.querySelector('feGaussianBlur');
        this.hatch = this.svg.querySelector('.hatch');
        this.reachFogGroup = this.svg.querySelector('.rfog');
        this.fogBlur = 0;
        this.hatchWidth = 0;
        // the Reachable overlay image of each layer of this map, built the first time the layer is shown
        this.reachUrls = {};
        // the layer's base image, fogged rectangles, Reachable image and hatch, and changed water: drawn again when the
        // layer or the Reachable switch changes (drawnLayer); reachEmpty: no Reachable image or hatch on the layer
        this.drawnLayer = null;
        this.reachEmpty = true;
        // the control that had focus when the panel opened gets it back when the panel closes
        this.opener = null;
        this.sized = false;
        this.waiting = [];
        this.viewport = panZoom(this.svg, this.keep, {
            insets: () => this.insets(),
            pick: (event) => this.pick(event),
            home: () => this.homeBox(),
            cap: () => this.capBox(),
            onView: () => this.viewChanged(),
            onIdle: () => gestureEndListener?.(),
        });
        this.wireControls();
        this.setKey(opts.key);
        this.wirePointer();
        new ResizeObserver(() => {
            if (this.box.isConnected) {
                this.placePanel();
                this.viewport.resize();
            }
            this.settle();
        }).observe(this.box);
        // a box that is never laid out (hidden)
        setTimeout(() => this.settle(), 500);
        this.panel.style.display = 'none';
        activeMap = this;
        this.draw();
    }

    panelOpen() {
        return this.panel.style.display !== 'none' && overlaid(this.panel);
    }
    insets() {
        let bottom = 0;
        if (this.keyBox.style.display !== 'none' && overlaid(this.keyBox))
            bottom = this.box.clientHeight - this.keyBox.offsetTop;
        return {
            top: overlaid(this.controls) ? this.controls.offsetTop + this.controls.offsetHeight : 0,
            right: this.panelOpen() ? this.box.clientWidth - this.panel.offsetLeft : 0,
            bottom,
        };
    }
    // the panel sits below the controls however many rows they wrap to; the key stays left of the panel
    // the key gives way to an open panel on a narrow map
    placePanel() {
        const keyHidden = !this.keyShown || (this.panelOpen() && this.box.clientWidth < 800);
        this.keyBox.style.display = keyHidden ? 'none' : '';
        if (!overlaid(this.panel)) return;
        const top = this.controls.offsetTop + this.controls.offsetHeight + 8;
        this.panel.style.top = top + 'px';
        this.panel.style.maxHeight = `calc(100% - ${top + 12}px)`;
        this.keyBox.style.maxWidth = this.panelOpen() ? `${Math.max(120, this.panel.offsetLeft - 24)}px` : '';
    }
    // with fog shown, the home view frames the uncovered regions of the layer plus the markers a click revealed under
    // the fog (else the levels shown on it), with a margin; the box is rebuilt on every draw
    homeBox() {
        if (!this.fogOn) return null;
        if (this.homeCache !== undefined) return this.homeCache;
        this.homeCache = this.uncoveredBox();
        return this.homeCache;
    }
    uncoveredBox() {
        const { opts } = this,
            layer = this.currentLayer;
        const spot = (x, y) => {
            const [mapX, mapY] = mapXY(x, y);
            return [mapX - 6, mapY - 6, 12, 12];
        };
        const shown = (opts.markers || []).filter((mk) => mapLayerOf(mk.z) === layer && !opts.style(mk).gone);
        const rects = opts.fog.open(layer).map(toMap);
        const anyOpen = rects.length > 0;
        for (const mk of shown) if (!anyOpen || opts.fog.at(layer, mk.x, mk.y, mk.z)) rects.push(spot(mk.x, mk.y));
        for (const tower of opts.towers || [])
            if (mapLayerOf(tower.z) === layer && opts.fog.at(layer, tower.x, tower.y, tower.z))
                rects.push(spot(tower.x, tower.y));
        if (!rects.length) return null;
        const box = torusBox(rects),
            margin = 2;
        return { x: box.x - margin, y: box.y - margin, w: box.w + 2 * margin, h: box.h + 2 * margin };
    }
    // the zoom-out cap is the layer's MAIN_MAP camera box, the view of the in-game overhead map: it fits the box on both
    // axes and centres on it
    capBox() {
        const camera = PROG.map.main_box?.[this.currentLayer];
        if (!camera) return null;
        const [mapX, mapY] = rawXY(camera.c[0], camera.c[1]);
        return { x: mapX - camera.e[0], y: mapY - camera.e[1], w: 2 * camera.e[0], h: 2 * camera.e[1] };
    }
    // A copy of the map answers pointer events as its use element, so the element under the pointer is found by
    // geometry among the interactive elements of the first copy (the last in document order is on top); null where a copy
    // has nothing. The first copy's own elements are their own targets.
    pick(event) {
        if (!event.target.matches?.('use[data-kx]')) return event.target;
        this.hitList ||= [...this.overlayGroup.querySelectorAll(INTERACTIVE)].map((element) => ({
            element,
            x: parseFloat(element.style.getPropertyValue('--x')),
            y: parseFloat(element.style.getPropertyValue('--y')),
        }));
        const point = this.viewport.toWorld(event),
            [width, height] = PROG.map.size,
            reach = 20 * Math.max(this.viewport.scale().s, 0.09);
        let hit = null;
        for (const candidate of this.hitList) {
            const dx = wrapDelta(candidate.x - point.x, width),
                dy = wrapDelta(candidate.y - point.y, height);
            if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
            const style = getComputedStyle(candidate.element);
            if (style.display === 'none' || style.pointerEvents === 'none') continue;
            const local = new DOMMatrix(style.transform)
                .inverse()
                .transformPoint(new DOMPoint(candidate.x - dx, candidate.y - dy));
            const inFill = style.fill !== 'none' && candidate.element.isPointInFill(local);
            const inStroke = style.stroke !== 'none' && candidate.element.isPointInStroke(local);
            if (inFill || inStroke) hit = candidate.element;
        }
        return hit;
    }
    viewChanged() {
        this.tip.style.display = 'none';
        if (this.layoutFrame) return;
        this.layoutFrame = requestAnimationFrame(() => {
            this.layoutFrame = 0;
            this.layout();
        });
    }
    layout() {
        const view = this.viewport.view();
        if (!view) return;
        this.placeLinks(view);
        this.cullLabels(view);
        this.softenFog(view);
    }
    // the fog's feathered edge keeps about the same width on screen: its blur and growth (a stroke in the fog colour,
    // 0.7 std outside each rectangle) follow the zoom; the hatch over fogged regions keeps its stripes 10 px apart on
    // screen
    softenFog(view) {
        // the stripes are 45 degrees: one world size along an axis is W / sqrt(2) along the stripe normal, so a period
        // that divides gcd(W, H) / sqrt(2) puts the stripes of every copy of the map on those of the first
        const [width, height] = PROG.map.size,
            unit = greatestCommonDivisor(width, height) / Math.SQRT2,
            hatchWidth = unit / Math.max(1, Math.round(unit / (10 * view.s)));
        if (this.hatch && hatchWidth !== this.hatchWidth) {
            this.hatchWidth = hatchWidth;
            this.hatch.setAttribute('width', hatchWidth);
            this.hatch.setAttribute('height', hatchWidth);
            this.hatch.firstChild.setAttribute('width', hatchWidth * 0.2);
            this.hatch.firstChild.setAttribute('height', hatchWidth);
        }
        const blur = Math.round(Math.min(2.2, Math.max(0.15, 7 * view.s)) * 20) / 20;
        if (blur === this.fogBlur) return;
        this.fogBlur = blur;
        this.blur.setAttribute('stdDeviation', blur);
        this.fogGroup.setAttribute('stroke-width', 1.4 * blur);
    }
    // the key's box in pixels when it is drawn over the map, else null
    keyRect() {
        const key = this.keyBox;
        if (key.style.display === 'none' || !overlaid(key)) return null;
        return [key.offsetLeft, key.offsetTop, key.offsetLeft + key.offsetWidth, key.offsetTop + key.offsetHeight];
    }
    // area labels keep a constant screen size (growing with the map once a square is bigger than the markers). Each copy
    // of a label is shown when its box lies in the area free of controls, the selection panel and the key and overlaps
    // no label placed before it, in label order
    cullLabels(view) {
        const { x0, y0, s: scale, r: viewRect } = view,
            insets = this.insets(),
            placed = [],
            on = new Set(),
            grow = Math.max(1, 0.09 / scale);
        const free = [6, insets.top + 6, viewRect.width - insets.right - 6, viewRect.height - 6];
        const keyRect = this.keyRect();
        const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
        const [width, height] = PROG.map.size;
        this.labels.forEach((label, index) => {
            const labelWidth = label.w * grow;
            // the copies whose label box can lie inside the free area
            const left = x0 + (free[0] + labelWidth / 2) * scale,
                right = x0 + (free[2] - labelWidth / 2) * scale,
                top = y0 + (free[1] + 17 * grow) * scale,
                bottom = y0 + (free[3] - 5 * grow) * scale;
            for (
                let copyY = Math.ceil((top - label.y) / height);
                copyY <= Math.floor((bottom - label.y) / height);
                copyY++
            )
                for (
                    let copyX = Math.ceil((left - label.x) / width);
                    copyX <= Math.floor((right - label.x) / width);
                    copyX++
                ) {
                    const x = (label.x + copyX * width - x0) / scale,
                        y = (label.y + copyY * height - y0) / scale,
                        rect = [x - labelWidth / 2, y - 17 * grow, x + labelWidth / 2, y + 5 * grow];
                    if ((keyRect && overlaps(rect, keyRect)) || placed.some((other) => overlaps(rect, other))) continue;
                    placed.push(rect);
                    on.add(this.labelText(label, index, copyX, copyY));
                }
        });
        for (const text of this.labelsOn) if (!on.has(text)) text.classList.add('off');
        for (const text of on) text.classList.remove('off');
        this.labelsOn = on;
    }
    // the text element of one copy of a label, made the first time it is shown
    labelText(label, index, copyX, copyY) {
        const [width, height] = PROG.map.size,
            copy = `${index}:${copyX}:${copyY}`;
        let text = this.labelPool.get(copy);
        if (text) return text;
        text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('class', 'area');
        text.setAttribute('x', label.x + copyX * width);
        text.setAttribute('y', label.y + copyY * height);
        text.textContent = label.text;
        this.labelsGroup.append(text);
        this.labelPool.set(copy, text);
        return text;
    }
    // a marker's drawn radius in path units (they are scaled by the map once a square is wider than 11 px, else by the
    // screen)
    endRadius(end) {
        if (isPosition(end)) return 9;
        const style = this.opts.style(this.opts.markers[end]),
            focused = this.selection?.focus === end;
        let radius = levelMarkerRadius(style, focused);
        if (style.star) radius = focused || style.big ? 9 : 6.5;
        return radius + 1;
    }
    // lines run from marker edge to marker edge; one with no visible stretch left is hidden
    placeLinks({ s: scale }) {
        const markerScale = Math.max(scale, 0.09),
            elements = this.linkElements;
        this.linkEnds.forEach(([x1, y1, startRadius, x2, y2, endRadius], index) => {
            const length = Math.hypot(x2 - x1, y2 - y1),
                startGap = startRadius * markerScale,
                endGap = endRadius * markerScale,
                visible = length - startGap - endGap >= 6 * scale;
            elements[index].style.display = visible ? '' : 'none';
            if (!visible) return;
            const ux = (x2 - x1) / length,
                uy = (y2 - y1) / length;
            elements[index].querySelectorAll('line').forEach((line) => {
                line.setAttribute('x1', x1 + ux * startGap);
                line.setAttribute('y1', y1 + uy * startGap);
                line.setAttribute('x2', x2 - ux * endGap);
                line.setAttribute('y2', y2 - uy * endGap);
            });
        });
    }
    // markers a click revealed inside the fog get a dark halo
    overFog(x, y, z) {
        if (this.fogOn && this.opts.fog?.at(this.currentLayer, x, y, z)) return ' fg';
        return '';
    }
    kept(overlay) {
        return !!this.selection?.ov?.has(overlay.id) || !this.opts.keep || this.opts.keep(overlay);
    }
    drawLayer() {
        const { opts, svg } = this,
            layer = this.currentLayer;
        // fogged squares are an opaque core; a blurred, grown copy feathers the outside edge only.
        // Both are clipped to the map, so fog ends at the map border.
        const rects = this.fogOn ? opts.fog.rects(layer) : [];
        const fogParts = rects.map(toMap).flatMap(wrapRect);
        this.fogGroup.innerHTML = fogParts.map((rect) => rectHtml(...rect, 0)).join('');
        // the slight overlap leaves no seams between neighbours
        this.fogCore.innerHTML = fogParts.map((rect) => rectHtml(...rect, 0.02)).join('');
        // a layer's base image is painted the first time the layer is shown
        svg.querySelectorAll('image:not(.reach)').forEach((image) => {
            const on = image.dataset.layer === layer;
            if (on && !image.hasAttribute('href')) image.setAttribute('href', mapLayerImage(mapLayer(layer), opts.fog));
            image.style.display = on ? '' : 'none';
        });
        if (opts.reach && !(layer in this.reachUrls))
            this.reachUrls[layer] = reachImage(mapLayer(layer), opts.reach, opts.fog);
        const reachUrl = opts.reach && this.reachUrls[layer];
        svg.querySelectorAll('image.reach').forEach((image) => {
            const on = overlayOn.reach && reachUrl && image.dataset.layer === layer;
            if (on && image.getAttribute('href') !== reachUrl) image.setAttribute('href', reachUrl);
            image.style.display = on ? '' : 'none';
        });
        // with the fog shown, fogged rectangles that hold a reached column are hatched whole, never square by square
        const reachFog = this.fogOn && opts.reach ? reachedRects(opts.reach[layer], rects) : [];
        let hatchHtml = '';
        if (overlayOn.reach)
            hatchHtml = reachFog.flatMap((rect) => wrapRect(toMap(rect)).map((part) => rectHtml(...part, 0))).join('');
        this.reachFogGroup.innerHTML = hatchHtml;
        svg.querySelector('.wtr').innerHTML = (opts.water?.[layer] || [])
            .map(([x, y]) => {
                const [mapX, mapY] = mapXY(x, y);
                return `<rect x="${mapX - 0.5}" y="${mapY - 0.5}" width="1" height="1"/>`;
            })
            .join('');
        this.box
            .querySelectorAll('[data-role=layers] button')
            .forEach((button) => segOn(button, button.dataset.layer === layer));
        this.reachEmpty = !reachUrl && !reachFog.length;
    }
    // whether an overlay toggle has nothing to switch on the current layer
    overlayEmpty(kind) {
        if (kind === 'reach') return this.reachEmpty;
        return !(this.opts.overlays || []).some(
            (overlay) => overlay.kind === kind && overlay.layer === this.currentLayer && this.kept(overlay),
        );
    }
    // markers that overlap stack by relevance: the selection's focus on top, then its levels, then by style rank
    stackRank(marker, style) {
        if (this.selection?.focus === marker.i) return 1e3;
        const rank = style.rank || 0;
        if (this.selection?.levels.has(marker.i)) return 100 + rank;
        return rank;
    }
    // ' hl' for a level of the selection, ' dim' for the others while there is one
    selectionClass(index) {
        if (!this.selection) return '';
        if (this.selection.levels.has(index)) return ' hl';
        return ' dim';
    }
    draw() {
        const { opts } = this,
            layer = this.currentLayer,
            selection = this.selection;
        if (this.drawnLayer !== layer + overlayOn.reach) {
            this.drawnLayer = layer + overlayOn.reach;
            this.drawLayer();
        }
        this.box.querySelectorAll('[data-ov]').forEach((button) => {
            segOn(button, overlayOn[button.dataset.ov]);
            button.classList.toggle('empty', this.overlayEmpty(button.dataset.ov));
        });
        this.drawnMarkers = [];
        this.homeCache = undefined;
        const order = (opts.markers || [])
            .filter((mk) => mapLayerOf(mk.z) === layer)
            .map((mk) => [mk, opts.style(mk)])
            .map(([mk, style]) => [mk, style, this.stackRank(mk, style)])
            .toSorted((a, b) => a[2] - b[2]);
        // a level filtered out is still drawn when it is the level the save is in or part of the selection
        const shown = (mk, style) => !(style.gone || (style.hidden && !style.cur && !selection?.levels.has(mk.i)));
        const drawnLevels = new Set(order.filter(([mk, style]) => shown(mk, style)).map(([mk]) => mk.i));
        let html = this.overlayMarksHtml(drawnLevels);
        html += this.linksHtml();
        html += this.towersHtml();
        for (const [mk, style] of order) if (shown(mk, style)) html += this.levelMarkerHtml(mk, style);
        if (opts.hero && mapLayerOf(opts.hero.z) === layer) {
            const [x, y] = mapXY(opts.hero.x, opts.hero.y);
            html += `<path class="k hero" d="${HERO_PATH}" ${placedAt(x, y)}/>`;
        }
        html += this.stepsHtml();
        // labels go on top (cullLabels makes their elements); they ignore the pointer, so markers under them stay
        // clickable
        this.labels = (opts.labels || [])
            .filter((label) => mapLayerOf(label.z) === layer)
            .map((label) => {
                const [x, y] = mapXY(label.x, label.y);
                return { text: label.text, x, y, w: label.text.length * 8.6 + 10 };
            });
        this.labelsGroup.replaceChildren();
        this.labelPool.clear();
        this.labelsOn = new Set();
        this.overlayGroup.innerHTML = html;
        this.linkElements = this.overlayGroup.querySelectorAll('g.lk');
        this.hitList = null;
        this.hover = null;
        this.layout();
    }
    // gates, signs, teleporters and treasures under everything else; gates, signs and gold rooms (o.attr) are clickable
    // through a larger invisible pad, the rest only carry a tooltip; a gate on a level's entrance (o.merge) is drawn
    // behind that level's marker while the marker is drawn
    overlayMarksHtml(drawnLevels) {
        let html = '';
        for (const overlay of this.opts.overlays || []) {
            if (overlay.layer !== this.currentLayer) continue;
            if (overlay.kind in overlayOn && !overlayOn[overlay.kind]) continue;
            if (!this.kept(overlay)) continue;
            if (overlay.merge != null && drawnLevels.has(overlay.merge)) continue;
            const [x, y] = mapXY(overlay.x, overlay.y);
            let state = '';
            if (this.selection?.ov?.has(overlay.id)) state += ' chosen';
            if (overlay.done === false) state += ' miss';
            const tip = `data-tip="${esc(overlay.tip)}"`;
            if (overlay.attr)
                html += `<path class="k pad" d="${OV_PAD}" ${placedAt(x, y)} ${overlay.attr} ${tip}/><path class="k ${overlay.cls}${state}" d="${overlay.d}" ${placedAt(x, y)} pointer-events="none"/>`;
            else html += `<path class="k ${overlay.cls}${state}" d="${overlay.d}" ${placedAt(x, y)} ${tip}/>`;
        }
        return html;
    }
    // a marker's [x, y, z], or null for a level marker that is not drawn
    endPoint(end) {
        if (isPosition(end)) return { x: end[0], y: end[1], z: end[2] };
        return this.opts.markers[end];
    }
    // lines from the selected level to the levels it requires (solid) and the ones it unlocks (dashed), on this layer,
    // under the towers and markers; placeLinks sets their ends for the current zoom
    linksHtml() {
        const layer = this.currentLayer,
            [width, height] = PROG.map.size,
            gone = (end) => !isPosition(end) && this.opts.style(this.opts.markers[end]).gone;
        let html = '';
        this.linkEnds = [];
        for (const [from, to, kind] of this.selection?.links || []) {
            const start = this.endPoint(from),
                finish = this.endPoint(to);
            if (!start || !finish || mapLayerOf(start.z) !== layer || mapLayerOf(finish.z) !== layer) continue;
            if (gone(from) || gone(to)) continue;
            // a dark halo under each line keeps it readable on any terrain
            html += `<g class="lk"><line class="link halo"/><line class="link ${kind}"/></g>`;
            // the far end is placed in the copy of the map nearest the near end, so a line over the seam runs the short
            // way
            const [x1, y1] = mapXY(start.x, start.y),
                [x2, y2] = mapXY(finish.x, finish.y);
            this.linkEnds.push([
                x1,
                y1,
                this.endRadius(from),
                x1 + wrapDelta(x2 - x1, width),
                y1 + wrapDelta(y2 - y1, height),
                this.endRadius(to),
            ]);
        }
        return html;
    }
    towersHtml() {
        let html = '';
        for (const tower of this.opts.towers || []) {
            if (mapLayerOf(tower.z) !== this.currentLayer) continue;
            const [x, y] = mapXY(tower.x, tower.y);
            let classes = 'tw';
            if (tower.on) classes += ' on';
            if (this.selection?.tower === tower.i) classes += ' hl';
            classes += this.overFog(tower.x, tower.y, tower.z);
            html += `<rect class="${classes}" x="-6" y="-6" width="12" height="12" ${placedAt(x, y)} data-tw="${tower.i}" data-tip="${esc(tower.tip)}"/>`;
        }
        return html;
    }
    // the square of the ice gate on a level's entrance, behind its marker
    iceGateHtml(mk, x, y) {
        const chosen = this.selection?.ov?.has(mk.ice.id);
        let classes = 'k gt';
        if (mk.ice.open) classes += ' open';
        if (chosen) classes += ' chosen';
        else if (this.selection && !this.selection.levels.has(mk.i)) classes += ' dim';
        classes += this.overFog(mk.x, mk.y, mk.z);
        const radius = this.endRadius(mk.i) + 0.5;
        return `<path class="${classes}" d="M${-radius} ${-radius}h${2 * radius}v${2 * radius}h${-2 * radius}Z" ${placedAt(x, y)} data-i="${mk.i}" data-tip="${esc(mk.tip)}"/>`;
    }
    levelMarkerHtml(mk, style) {
        const selection = this.selection,
            [x, y] = mapXY(mk.x, mk.y),
            focused = selection?.focus === mk.i,
            big = focused || style.big;
        let classes = this.selectionClass(mk.i);
        if (selection?.frontier?.has(mk.i)) classes += ' fr';
        if (style.ring) classes += ' ring';
        classes += this.overFog(mk.x, mk.y, mk.z);
        const position = placedAt(x, y),
            data = `data-i="${mk.i}" data-tip="${esc(mk.tip)}"`;
        let html = '';
        if (mk.ice && overlayOn.gates) html += this.iceGateHtml(mk, x, y);
        if (style.star)
            html += `<path class="lv k star${classes}" d="${big ? STAR_BIG : STAR}" ${position} fill="${style.color}" ${data}/>`;
        else {
            const shape = SHAPES[style.shape] || SHAPES.circle;
            html += `<path class="lv k${classes}" d="${shape.path(levelMarkerRadius(style, focused))}" ${position} fill="${style.color}" ${data}/>`;
        }
        if (style.cur) html += `<path class="k cur" d="${SHAPES.circle.path(big ? 11 : 9)}" ${position}/>`;
        if (style.ach) {
            const dim = selection && !selection.levels.has(mk.i) ? ' dim' : '';
            html += `<path class="k achb${dim}" d="${ACH_BADGE(big ? 7 : 5)}" ${position}/>`;
        }
        this.drawnMarkers.push({ x, y, tip: mk.tip });
        return html;
    }
    // the steps of the unlock chain are numbered on top of the markers
    stepsHtml() {
        let html = '';
        for (const [end, number] of this.selection?.steps || []) {
            const mk = this.endPoint(end);
            if (!mk || mapLayerOf(mk.z) !== this.currentLayer) continue;
            if (!isPosition(end) && this.opts.style(mk).gone) continue;
            const [x, y] = mapXY(mk.x, mk.y);
            html += `<g class="bd" ${placedAt(x, y)}><circle r="10"/><text y="5.5">${number}</text></g>`;
        }
        return html;
    }
    // switches the layer (not to one the fog has not uncovered); onLayer lets the lists follow
    canShow(layer) {
        return !this.known || this.known.includes(layer);
    }
    showLayer(layer) {
        this.currentLayer = this.keep.layer = layer;
        this.draw();
        this.opts.onLayer?.(layer);
    }
    wireControls() {
        const { box, opts } = this;
        box.querySelectorAll('[data-z]').forEach((button) =>
            button.addEventListener('click', () => this.viewport.zoom(Number(button.dataset.z))),
        );
        const heroButton = box.querySelector('[data-hero]');
        heroButton.hidden = !opts.hero;
        heroButton.addEventListener('click', () => {
            if (!opts.hero) return;
            if (this.selection) this.select(null);
            this.fitPts([[opts.hero.x, opts.hero.y, opts.hero.z]]);
        });
        box.querySelectorAll('[data-role=layers] button').forEach((button) =>
            button.addEventListener('click', () => this.setLayer(button.dataset.layer)),
        );
        box.querySelector('[data-role=ovl]').hidden = !opts.overlays?.length && !opts.reach;
        box.querySelectorAll('[data-ov]').forEach((button) => {
            button.hidden = button.dataset.ov === 'reach' && !opts.reach;
            button.addEventListener('click', () => this.setOverlay(button.dataset.ov, !overlayOn[button.dataset.ov]));
        });
    }
    // the marker under the pointer is highlighted by a class, which the copies of the map follow (:hover does not reach
    // them)
    setHover(element) {
        if (element === this.hover) return;
        this.hover?.classList.remove('hv');
        this.hover = element;
        this.hover?.classList.add('hv');
    }
    // the tooltips of the drawn markers that overlap under the cursor, up to eight
    nearTips(event, html) {
        const { s: scale } = this.viewport.scale(),
            point = this.viewport.toWorld(event),
            [width, height] = PROG.map.size;
        const near = this.drawnMarkers.filter(
            (marker) =>
                Math.hypot(wrapDelta(marker.x - point.x, width), wrapDelta(marker.y - point.y, height)) <=
                7 * Math.max(scale, 0.09),
        );
        if (near.length <= 1) return html;
        let tips = near
            .slice(0, 8)
            .map((marker) => marker.tip)
            .join('<hr>');
        if (near.length > 8) tips += `<hr><span class="muted">${near.length - 8} more</span>`;
        return tips;
    }
    showTip(event) {
        const { svg, tip } = this;
        if (svg.classList.contains('drag')) return this.setHover(null);
        const target = this.pick(event)?.closest('[data-tip]');
        this.setHover(target?.matches('.lv') ? target : null);
        if (!target) {
            tip.style.display = 'none';
            return;
        }
        const boxRect = this.box.getBoundingClientRect();
        let html = target.dataset.tip;
        // markers that overlap under the cursor are listed together
        if (target.dataset.i != null) html = this.nearTips(event, html);
        if (html !== this.tipHtml) tip.innerHTML = this.tipHtml = html;
        tip.style.display = 'block';
        const cursorX = event.clientX - boxRect.left,
            cursorY = event.clientY - boxRect.top,
            tipHeight = tip.offsetHeight;
        tip.style.left = Math.max(8, Math.min(boxRect.width - tip.offsetWidth - 8, cursorX + 14)) + 'px';
        let top = cursorY + 14;
        if (top + tipHeight > boxRect.height - 8) top = Math.max(8, cursorY - 10 - tipHeight);
        tip.style.top = top + 'px';
    }
    // an empty click closes the panel at once (a double-click then zooms with it closed)
    clicked(event) {
        if (this.svg.wasDragged || event.detail > 1) return;
        const target = this.pick(event),
            tower = target?.closest('[data-tw]'),
            level = target?.closest('[data-i]'),
            gate = target?.closest('[data-gate]'),
            sign = target?.closest('[data-sign]'),
            gateTower = target?.closest('[data-gtw]');
        if (tower && this.onTower) this.onTower(Number(tower.dataset.tw));
        else if (level && this.onPick) this.onPick(Number(level.dataset.i));
        else if (gate && this.onGate) this.onGate(Number(gate.dataset.gate));
        else if (sign && this.onSign) this.onSign(Number(sign.dataset.sign));
        else if (gateTower && this.onTower) this.onTower(Number(gateTower.dataset.gtw));
        else if (this.selection) this.select(null);
    }
    wirePointer() {
        const { svg } = this;
        svg.addEventListener('mousemove', (event) => this.showTip(event));
        svg.addEventListener('mouseleave', () => {
            this.tip.style.display = 'none';
            this.setHover(null);
        });
        svg.addEventListener('click', (event) => this.clicked(event));
    }
    settle() {
        if (this.sized) return;
        this.sized = true;
        this.waiting.splice(0).forEach((run) => run());
    }
    // frames the selection's points on the current layer: a level selection zooms in when the map is far out, so
    // neighbouring requirements and their lines separate
    frameSelection(selection) {
        const points = (selection.pts || [])
            .filter((point) => mapLayerOf(point[2]) === this.currentLayer)
            .map((point) => mapXY(point[0], point[1]));
        if (!points.length) return;
        const box = boxOf(points);
        const { r: viewRect, s: scale } = this.viewport.scale();
        const frame = { ...this.insets(), m: FRAME_MARGIN };
        if (selection.links && (selection.exact || viewRect.width * scale > MIN_BOX * 2.5)) {
            const min = selection.steps?.length && !selection.exact ? MIN_CHAIN_BOX : MIN_BOX;
            this.viewport.fit(padBox(box, min), frame);
        } else this.viewport.reveal(box, frame);
    }

    redraw() {
        this.draw();
    }
    // switches an overlay toggle (remembered like a click); returns whether it was on
    setOverlay(kind, on) {
        const was = overlayOn[kind];
        if (was === on) return was;
        overlayOn[kind] = on;
        setPref('mapOverlays', JSON.stringify(overlayOn));
        this.draw();
        return was;
    }
    // pulses the overlay marks of one class (path classes) that are not found yet, on the current layer
    flash(cls) {
        const marks = [...this.overlayGroup.querySelectorAll(`.k.miss.${cls}`)];
        marks.forEach((mark) => mark.classList.add('pulse'));
        setTimeout(() => marks.forEach((mark) => mark.classList.remove('pulse')), 2400);
    }
    // the layer and view, to come back to with setView
    getView() {
        return {
            layer: this.currentLayer,
            vb: this.keep.vb && { ...this.keep.vb },
            moved: !!this.keep.moved,
        };
    }
    setView(view) {
        if (view.layer !== this.currentLayer && this.canShow(view.layer)) this.showLayer(view.layer);
        if (view.vb) this.viewport.goTo(view.vb, view.moved);
        else this.viewport.reset();
    }
    setKey(html) {
        this.keyBox.innerHTML = html || '';
        this.keyShown = !!html;
        this.placePanel();
        this.viewport.resize();
    }
    setLayer(layer) {
        if (layer === this.currentLayer || !this.canShow(layer)) return;
        this.currentLayer = this.keep.layer = layer;
        this.draw();
        this.viewport.resize();
        this.opts.onLayer?.(layer);
    }
    get busy() {
        return this.box.isConnected && this.viewport.busy;
    }
    // runs run() once the box has been laid out (its first resize), at once when it has
    ready(run) {
        if (this.sized) return run();
        return this.waiting.push(run);
    }
    get layer() {
        return this.currentLayer;
    }
    get layers() {
        return AREA_LAYERS.filter((key) => PROG.map.layers.some((layer) => layer.key === key) && this.canShow(key));
    }
    reset() {
        if (this.box.isConnected) this.viewport.reset();
    }
    get open() {
        return !!this.selection && this.box.isConnected;
    }
    // selection: {levels: Set, tower, exact (always fit the points, with at least MIN_BOX squares around them), focus,
    // frontier: Set, ov: Set of overlay ids, html, z, pts: [[x, y, z]], links, steps: [[marker index or [x, y, z],
    // number]]} or null; how: {still (keep the view and the focus), keepFocus}
    select(selection, how = {}) {
        const { panel, opts } = this;
        const inPanel = panel.contains(document.activeElement);
        // the level in a selected ice gate is selected with it
        this.selection = selection && {
            ...selection,
            levels: new Set([
                ...selection.levels,
                ...(opts.markers || []).filter((mk) => mk.ice && selection.ov?.has(mk.ice.id)).map((mk) => mk.i),
            ]),
        };
        panel.innerHTML = selection?.html || '';
        panel.style.display = selection?.html ? '' : 'none';
        // a level on a layer the fog has not uncovered keeps the current layer
        const before = this.currentLayer;
        if (selection?.z != null && !how.still && this.canShow(mapLayerOf(selection.z)))
            this.currentLayer = this.keep.layer = mapLayerOf(selection.z);
        this.placePanel();
        this.draw();
        if (this.currentLayer !== before) opts.onLayer?.(this.currentLayer);
        panel.querySelector('[data-close]')?.addEventListener('click', () => this.select(null));
        if (selection && !how.still && !how.keepFocus) {
            if (!inPanel && document.activeElement !== document.body) this.opener = document.activeElement;
            panel.querySelector('.hd b')?.focus({ preventScroll: true });
        }
        if (!selection) {
            opts.onClose?.();
            if (this.opener?.isConnected && (inPanel || document.activeElement === document.body))
                this.opener.focus({ preventScroll: true });
            this.opener = null;
        }
        if (selection && !how.still) this.frameSelection(selection);
    }
    // zooms to world points [x, y, z], first moving to their layer when none is on the current one
    fitPts(points) {
        if (!points.length) return;
        if (!points.some((point) => mapLayerOf(point[2]) === this.currentLayer)) {
            const layer = mapLayerOf(points[0][2]);
            if (!this.canShow(layer)) return;
            this.showLayer(layer);
        }
        const onLayer = points
            .filter((point) => mapLayerOf(point[2]) === this.currentLayer)
            .map((point) => mapXY(point[0], point[1]));
        this.viewport.fit(padBox(boxOf(onLayer)), { ...this.insets(), m: FRAME_MARGIN });
    }
}

export function mapInit(id, opts) {
    return new MapView(id, opts);
}
