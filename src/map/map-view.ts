// The overworld map of the progress view (VIEWER.md "The page (viewer)"): one layer's base image under the fog, the
// Reachable overlay, the overlay marks, the level and tower markers with the selection's links and steps, the area
// labels, the selection panel, the key and the tooltip, over panZoom's view of the wrapping map
import { PROG } from '../data.ts';
import type { Fog, FogRect } from '../fog.ts';
import { AREA_LAYERS, mapLayerOf, wrapDelta } from '../model/layers.ts';
import { panZoom } from '../panzoom.ts';
import type { Box, Insets, PanZoom, ViewCorner } from '../panzoom.ts';
import { setPreference } from '../shared.ts';
import type { MapLayer, Position } from '../types.ts';
import { $, setButtonPressed } from '../util.ts';
import { achievementBadgePath, HERO_PATH, OVERLAY_PAD, SHAPES, STAR, STAR_BIG } from './icons.ts';
import type { ShapeName } from './icons.ts';
import { mapLayerImage } from './layer-image.ts';
import type { OceanSquares } from './layer-image.ts';
import { isOverlayKind, knownLayers, mapKeep, overlayOn, startLayer } from './map-html.ts';
import type { MapKeep, OverlayKind } from './map-html.ts';
import { LayerMarks } from './mark-pool.ts';
import type { MarkAttributes } from './mark-pool.ts';
import { reachedRects, reachImage } from './reach-image.ts';
import { mapXY, rawXY, torusBox, wrapRect } from './torus.ts';
import type { Rect } from './torus.ts';

/** The overlay of a Freezer on a level's entrance: the overlay id of the Freezer and whether it is open. */
export interface MapFreezer {
    id: string;
    open: boolean;
}

/** A level marker. `tip` is the tooltip's html, made when it is shown. */
export interface MapMarker {
    levelIndex: number;
    x: number;
    y: number;
    z: number;
    ice?: MapFreezer;
    readonly tip: string;
}

/** How a level marker is drawn. */
export interface MarkerStyle {
    /** The list filter leaves the level out. */
    hidden: boolean;
    /** The level is under fog and not drawn at all. */
    gone: boolean;
    color: string;
    star: boolean;
    shape: ShapeName;
    ring: boolean;
    big: boolean;
    /** The level has an achievement. */
    achievement: boolean;
    /** The save is in the level. */
    current: boolean;
    rank: number;
}

/** A tower marker. */
export interface MapTower {
    towerIndex: number;
    x: number;
    y: number;
    z: number;
    activated: boolean;
    tip: string;
}

/** An area label. */
export interface MapLabel {
    x: number;
    y: number;
    z: number;
    text: string;
}

/**
 * A mark of the overlay group. `kind` is an overlay switch (gates, tps, logs, reach) or treasures or maps, which are
 * always drawn; `layer` is the map layer key; `cls` and `d` are the mark's path classes and path in screen pixels;
 * `done` is false while the thing is not done yet; `attr` is the data attribute [name, value] that makes the mark
 * clickable; `merge` is the marker index whose backing square replaces the mark while that marker is drawn; `req` is
 * false for a gate the goal does not need.
 */
export interface MapOverlay {
    kind: string;
    layer: string;
    x: number;
    y: number;
    cls: string;
    d: string;
    tip: string;
    id?: string;
    done?: boolean;
    attr?: [name: string, value: string | number];
    merge?: number;
    req?: boolean;
}

/** An end of a link: a marker index, or the position of a tower. */
export type LinkEnd = number | Position;

/** A line from the first end to the second: solid for a requirement, dashed for what it unlocks. */
export type MapLink = [from: LinkEnd, to: LinkEnd, kind: 'req' | 'unl'];

/** A numbered badge of an unlock chain on one of its ends. */
export type MapStep = [end: LinkEnd, number: number];

/**
 * What the map highlights: `levels` are the markers of the selection, `tower` the tower index, `exact` always fits the
 * points (with at least MIN_BOX squares around them), `focus` the level marker on top, `frontier` the levels at the
 * chain's frontier, `overlays` the overlay ids, `html` the panel's body, `z` the height that picks the layer, `points`
 * the points to frame, `links` the lines and `steps` the numbered badges.
 */
export interface MapSelection {
    levels: Set<number>;
    tower?: number;
    exact?: boolean;
    focus?: number;
    frontier?: Set<number>;
    overlays?: Set<string>;
    html?: string;
    z?: number;
    points?: Position[];
    links?: MapLink[];
    steps?: MapStep[];
}

/** still keeps the view and the focus; keepFocus keeps the focus only. */
export interface SelectHow {
    still?: boolean;
    keepFocus?: boolean;
}

/** A world point with a height: a marker, a tower or the hero. */
export interface MapPoint {
    x: number;
    y: number;
    z: number;
}

/**
 * markers: the level markers; style(marker): how one is drawn; towers; labels: the area labels; hero; fog (shown and
 * framed as the home view when given); key: the key's html; onClose(); keep(overlay): whether the list filter keeps an
 * overlay (the selection's overlays are drawn whatever it says); reach: the column bitmap of the reached squares per
 * layer key (the Reachable overlay; without it the toggle is hidden); overlays: the marks of the overlay group;
 * onLayer(key); water: the squares of changed water per layer key.
 */
export interface MapOptions {
    markers: MapMarker[];
    style: (marker: MapMarker) => MarkerStyle;
    towers: MapTower[];
    labels: MapLabel[];
    hero?: MapPoint | null;
    fog?: Fog | null;
    key?: string;
    onClose?: () => void;
    keep?: (overlay: MapOverlay) => boolean;
    reach?: Record<string, Uint8Array>;
    overlays: MapOverlay[];
    onLayer?: (key: string) => void;
    water?: OceanSquares;
}

/** The layer and view of a map, to come back to with setView. */
export interface MapViewState {
    layer: string;
    vb: Box | undefined;
    moved: boolean;
}

/** A level marker with the style it is drawn in. */
interface StyledMarker {
    marker: MapMarker;
    style: MarkerStyle;
}

/** An interactive element of the first copy of the map and its position in map pixels. */
interface HitTarget {
    element: SVGGeometryElement;
    x: number;
    y: number;
}

/** An area label placed on the map: its text, position and box width in pixels at the smallest label size. */
interface PlacedLabel {
    text: string;
    x: number;
    y: number;
    width: number;
}

/** A level marker of the last draw. */
interface DrawnMarker {
    x: number;
    y: number;
    levelIndex: number;
}

/** The two ends of a drawn link with the radii of the markers on them: x1, y1, start radius, x2, y2, end radius. */
type LinkEndpoints = [x1: number, y1: number, startRadius: number, x2: number, y2: number, endRadius: number];

/** A box in screen pixels: left, top, right, bottom. */
type PixelRect = [left: number, top: number, right: number, bottom: number];

/** The pixels of the map covered by its controls, panel and key. */
interface MapInsets {
    top: number;
    right: number;
    bottom: number;
}

// the map drawn last
export let activeMap: MapView | null = null;

// told when a drag, pinch or eased zoom of a map ends
let gestureEndListener: (() => void) | null = null;

export function onGestureEnd(listener: () => void): void {
    gestureEndListener = listener;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// the elements a pointer event can be on, found by geometry in the copies of the map
const INTERACTIVE = '[data-i],[data-tw],[data-gate],[data-sign],[data-gtw],[data-tip]';

// the smallest box a selection or a set of points is framed in, in squares; an unlock chain's steps get a closer one
const MIN_BOX = 24;

const MIN_CHAIN_BOX = 8;

// the margin around a framed box, in pixels
const FRAME_MARGIN = 28;

// how far a mark reaches from its position, in mark units (--mk squares): the largest, a selected tower with its stroke
// and glow, and a step badge stay within it
const MARK_REACH = 32;

// the part of the map's markup that matches a selector; the markup always has it
function find<Part extends Element>(root: ParentNode, selector: string, type: abstract new () => Part): Part {
    const part = root.querySelector(selector);
    if (!(part instanceof type)) throw new Error(`The map has no ${selector}`);
    return part;
}

const overlaid = (element: HTMLElement): boolean => getComputedStyle(element).position === 'absolute';

// world rectangle [x, y, w, h] to map coordinates
function toMap([x, y, width, height]: Rect): Rect {
    const [mapX, mapY] = rawXY(x, y + height);
    return [mapX - 0.5, mapY + 0.5, width, height];
}

const rectHtml = (x: number, y: number, width: number, height: number, grow: number): string =>
    `<rect x="${x - grow}" y="${y - grow}" width="${width + 2 * grow}" height="${height + 2 * grow}"/>`;

// the screen position of a mark, which its transform reads
const placedAt = (x: number, y: number): string => `--x:${x.toFixed(2)}px;--y:${y.toFixed(2)}px`;

// the attributes of a mark, hidden when it is not drawn
function hiddenWhen(hidden: boolean, attributes: MarkAttributes): MarkAttributes {
    if (hidden) attributes.display = 'none';
    return attributes;
}

const boxOf = (points: Array<[number, number]>): Box => torusBox(points.map(([x, y]): Rect => [x, y, 0, 0]));

function padBox(box: Box, min = MIN_BOX): Box {
    const width = Math.max(box.w, min);
    const height = Math.max(box.h, min);
    return { x: box.x - (width - box.w) / 2, y: box.y - (height - box.h) / 2, w: width, h: height };
}

const greatestCommonDivisor = (first: number, second: number): number =>
    second ? greatestCommonDivisor(second, first % second) : first;

function mapLayer(key: string): MapLayer {
    const layer = PROG.map.layers.find((candidate) => candidate.key === key);
    if (!layer) throw new Error(`The map has no layer ${key}`);
    return layer;
}

// a level marker's path radius: larger for the focused level and for big markers
function levelMarkerRadius(style: MarkerStyle, focused: boolean): number {
    if (focused) return 8;
    if (style.big) return 7;
    return 5;
}

// an end of a link: a marker index, or an [x, y, z] position (a tower)
const isPosition = (end: LinkEnd): end is Position => Array.isArray(end);

// the overlay switch a button of the map's controls stands for
function overlayKindOf(button: HTMLElement): OverlayKind {
    const kind = button.dataset.ov;
    if (kind === undefined || !isOverlayKind(kind)) throw new Error(`The map has no overlay ${kind}`);
    return kind;
}

// the element to give focus back to: the focused element, when it can take focus
function focusableOf(element: Element | null): HTMLElement | SVGElement | null {
    if (element instanceof HTMLElement || element instanceof SVGElement) return element;
    return null;
}

// The caller sets onPick(level), onTower(i), onGate(i) and onSign(i) for clicks on the map.
export class MapView {
    onPick?: (level: number) => void;
    onTower?: (tower: number) => void;
    onGate?: (gate: number) => void;
    onSign?: (sign: number) => void;

    private options: MapOptions;
    private box: HTMLElement;
    private svg: SVGSVGElement;
    private overlayGroup: SVGGElement;
    private tip: HTMLElement;
    private panel: HTMLElement;
    private controls: HTMLElement;
    private keyBox: HTMLElement;
    private keep: MapKeep;
    private keyShown = false;
    private layoutFrame = 0;
    private currentLayer: string;

    // the selection (see select), or null
    private selection: MapSelection | null = null;

    // the level markers of the last draw, for the tooltip of overlapping ones
    private drawnMarkers: DrawnMarker[] = [];

    private linkEnds: LinkEndpoints[] = [];
    private fogOn: boolean;

    // with fog shown, layers the player has not uncovered yet have no button (mapHtml leaves them out)
    private known: string[] | null;

    // undefined until the home box is worked out for the current draw
    private homeCache: Box | null | undefined = undefined;

    private hitList: HitTarget[] | null = null;
    private hover: Element | null = null;
    private tipHtml = '';

    // the marks of each layer drawn so far, by layer key, and those of the layer shown; the lines, labels, fog edge
    // and hatch follow the view
    private layerMarks = new Map<string, LayerMarks>();

    private marks: LayerMarks | null = null;

    // The area labels sit outside the repeated overlay group: each copy of the map has a text element of its own,
    // made the first time that copy's label is shown. labels: the labels of the last draw;
    // labelPool: the text elements by label and copy; labelsOn: the ones shown
    private labelsGroup: SVGGElement;

    private labelPool = new Map<string, SVGTextElement>();
    private labelsLayer: string | null = null;
    private labels: PlacedLabel[] = [];
    private labelsOn = new Set<SVGTextElement>();
    private fogGroup: SVGGElement;
    private fogCore: SVGGElement;
    private blur: SVGFEGaussianBlurElement;
    private hatch: SVGPatternElement | null;
    private reachFogGroup: SVGGElement;
    private fogBlur = 0;
    private hatchWidth = 0;

    // the Reachable overlay image of each layer of this map, built the first time the layer is shown
    private reachUrls: Record<string, string | null> = {};

    // the layer's base image, fogged rectangles, Reachable image and hatch, and changed water: drawn again when the
    // layer or the Reachable switch changes (drawnLayer); reachEmpty: no Reachable image or hatch on the layer
    private drawnLayer: string | null = null;

    private reachEmpty = true;

    // the control that had focus when the panel opened gets it back when the panel closes
    private opener: HTMLElement | SVGElement | null = null;

    private sized = false;
    private waiting: Array<() => void> = [];

    // how far past the map the far ends of the selection's lines lie, in squares
    private linkReach = 0;

    private viewport: PanZoom;

    constructor(id: string, options: MapOptions) {
        this.options = options;
        this.box = $('#' + id);
        this.svg = find(this.box, 'svg', SVGSVGElement);
        this.overlayGroup = find(this.svg, '.ov', SVGGElement);
        this.tip = find(this.box, '.tip', HTMLElement);
        this.panel = find(this.box, '.sel', HTMLElement);
        this.controls = find(this.box, '.ctl', HTMLElement);
        this.keyBox = find(this.box, '.key', HTMLElement);
        this.keep = mapKeep(id);
        this.currentLayer = startLayer(this.keep, options.fog);
        this.fogOn = !!options.fog;
        this.known = knownLayers(options.fog);

        // the layers share coordinates, so a layer that cannot be kept (no longer uncovered) leaves the view where it was
        this.keep.layer = this.currentLayer;

        this.labelsGroup = find(this.svg, 'g.lbl', SVGGElement);
        this.fogGroup = find(this.svg, '.fog', SVGGElement);
        this.fogCore = find(this.svg, '.fogc', SVGGElement);
        this.blur = find(this.svg, 'feGaussianBlur', SVGFEGaussianBlurElement);
        this.hatch = this.svg.querySelector<SVGPatternElement>('.hatch');
        this.reachFogGroup = find(this.svg, '.rfog', SVGGElement);

        this.viewport = panZoom(this.svg, this.keep, {
            insets: () => this.insets(),
            pick: (event) => this.pick(event),
            home: () => this.homeBox(),
            cap: () => this.capBox(),
            onView: () => this.viewChanged(),
            onIdle: () => gestureEndListener?.(),
            scaled: [this.overlayGroup, this.labelsGroup],
            reach: (group, scale) => this.copyReach(group, scale),
        });

        this.wireControls();
        this.setKey(options.key);
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
        this.draw();
    }

    // puts the marks of a layer (made the first time it is drawn) in the overlay group in place of the last layer's
    private showMarks(layer: string): void {
        let marks = this.layerMarks.get(layer);
        if (!marks) {
            marks = new LayerMarks();
            this.layerMarks.set(layer, marks);
        }

        if (marks === this.marks) return;

        this.overlayGroup.replaceChildren(marks.root);
        this.marks = marks;
    }

    // the marks of the layer shown, which every draw makes first
    private get shownMarks(): LayerMarks {
        if (!this.marks) throw new Error('The map has not drawn a layer yet');
        return this.marks;
    }

    private panelOpen(): boolean {
        return this.panel.style.display !== 'none' && overlaid(this.panel);
    }

    private insets(): MapInsets {
        let bottom = 0;
        if (this.keyBox.style.display !== 'none' && overlaid(this.keyBox)) {
            bottom = this.box.clientHeight - this.keyBox.offsetTop;
        }

        let top = 0;
        if (overlaid(this.controls)) top = this.controls.offsetTop + this.controls.offsetHeight;

        let right = 0;
        if (this.panelOpen()) right = this.box.clientWidth - this.panel.offsetLeft;
        return { top, right, bottom };
    }

    // the panel sits below the controls however many rows they wrap to; the key stays left of the panel
    // the key gives way to an open panel on a narrow map
    private placePanel(): void {
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
    private homeBox(): Box | null {
        if (!this.fogOn) return null;
        if (this.homeCache !== undefined) return this.homeCache;

        this.homeCache = this.uncoveredBox();
        return this.homeCache;
    }

    private uncoveredBox(): Box | null {
        const { options } = this;
        const fog = options.fog;
        if (!fog) return null;

        const layer = this.currentLayer;
        const spot = (x: number, y: number): Rect => {
            const [mapX, mapY] = mapXY(x, y);
            return [mapX - 6, mapY - 6, 12, 12];
        };

        const shown = (options.markers || []).filter(
            (marker) => mapLayerOf(marker.z) === layer && !options.style(marker).gone,
        );
        const rects = fog.open(layer).map(toMap);
        const anyOpen = rects.length > 0;

        for (const marker of shown) {
            if (!anyOpen || fog.at(layer, marker.x, marker.y, marker.z)) rects.push(spot(marker.x, marker.y));
        }

        for (const tower of options.towers || []) {
            if (mapLayerOf(tower.z) === layer && fog.at(layer, tower.x, tower.y, tower.z)) {
                rects.push(spot(tower.x, tower.y));
            }
        }

        if (!rects.length) return null;

        const box = torusBox(rects);
        const margin = 2;
        return { x: box.x - margin, y: box.y - margin, w: box.w + 2 * margin, h: box.h + 2 * margin };
    }

    // how far the copies of a group reach past the map, in squares: the terrain not at all (it is clipped to the map),
    // the marks by their size and the selection's lines by their far ends
    private copyReach(group: string | null, scale: number): number {
        if (group !== `#${this.box.id}-o`) return 0;
        return MARK_REACH * Math.max(scale, 0.09) + this.linkReach;
    }

    // the zoom-out cap is the layer's MAIN_MAP camera box, the view of the in-game overhead map: it fits the box on
    // both axes and centres on it
    private capBox(): Box | null {
        const camera = PROG.map.main_box?.[this.currentLayer];
        if (!camera) return null;

        const [mapX, mapY] = rawXY(camera.c[0], camera.c[1]);
        return { x: mapX - camera.e[0], y: mapY - camera.e[1], w: 2 * camera.e[0], h: 2 * camera.e[1] };
    }

    // The interactive elements of the first copy of the map, with their positions
    private hitTargets(): HitTarget[] {
        if (!this.hitList) {
            const elements = this.shownMarks.root.querySelectorAll<SVGGeometryElement>(INTERACTIVE);
            this.hitList = [...elements].map((element) => ({
                element,
                x: parseFloat(element.style.getPropertyValue('--x')),
                y: parseFloat(element.style.getPropertyValue('--y')),
            }));
        }

        return this.hitList;
    }

    // A copy of the map answers pointer events as its use element, so the element under the pointer is found by
    // geometry among the interactive elements of the first copy (the last in document order is on top); null where a
    // copy has nothing. The first copy's own elements are their own targets.
    private pick(event: MouseEvent): Element | null {
        const target = event.target;
        if (!(target instanceof Element)) return null;
        if (!target.matches('use[data-kx]')) return target;

        const hitList = this.hitTargets();
        const point = this.viewport.toWorld(event);
        const [width, height] = PROG.map.size;
        const reach = 20 * Math.max(this.viewport.scale().scale, 0.09);
        let hit: Element | null = null;

        for (const candidate of hitList) {
            const dx = wrapDelta(candidate.x - point.x, width);
            const dy = wrapDelta(candidate.y - point.y, height);
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

    private viewChanged(): void {
        this.tip.style.display = 'none';
        if (this.layoutFrame) return;

        this.layoutFrame = requestAnimationFrame(() => {
            this.layoutFrame = 0;
            this.layout();
        });
    }

    private layout(): void {
        const view = this.viewport.view();
        if (!view) return;

        this.placeLinks(view);
        this.cullLabels(view);
        this.softenFog(view);
    }

    // the fog's feathered edge keeps about the same width on screen: its blur and growth (a stroke in the fog colour,
    // 0.7 std outside each rectangle) follow the zoom; the hatch over fogged regions keeps its stripes 10 px apart on
    // screen
    private softenFog(view: ViewCorner): void {
        // the stripes are 45 degrees: one world size along an axis is W / sqrt(2) along the stripe normal, so a period
        // that divides gcd(W, H) / sqrt(2) puts the stripes of every copy of the map on those of the first
        const [width, height] = PROG.map.size;
        const unit = greatestCommonDivisor(width, height) / Math.SQRT2;
        const hatchWidth = unit / Math.max(1, Math.round(unit / (10 * view.scale)));
        if (this.hatch && hatchWidth !== this.hatchWidth) {
            this.hatchWidth = hatchWidth;
            this.hatch.setAttribute('width', String(hatchWidth));
            this.hatch.setAttribute('height', String(hatchWidth));

            const stripe = this.hatch.firstElementChild;
            stripe?.setAttribute('width', String(hatchWidth * 0.2));
            stripe?.setAttribute('height', String(hatchWidth));
        }

        const blurRadius = Math.round(Math.min(2.2, Math.max(0.15, 7 * view.scale)) * 20) / 20;
        if (blurRadius === this.fogBlur) return;

        this.fogBlur = blurRadius;
        this.blur.setAttribute('stdDeviation', String(blurRadius));
        this.fogGroup.setAttribute('stroke-width', String(1.4 * blurRadius));
    }

    // area labels keep a constant screen size (growing with the map once a square is bigger than the markers). Each copy
    // of a label is shown when its anchor lies inside the view, whatever covers that part of the map, and its box
    // overlaps no label placed before it, in label order
    private cullLabels(view: ViewCorner): void {
        const { x0, y0, scale, rect: viewRect } = view;
        const placed: PixelRect[] = [];
        const shownTexts = new Set<SVGTextElement>();
        const grow = Math.max(1, 0.09 / scale);
        const overlaps = (first: PixelRect, second: PixelRect): boolean =>
            first[0] < second[2] && first[2] > second[0] && first[1] < second[3] && first[3] > second[1];
        const [width, height] = PROG.map.size;
        const right = x0 + viewRect.width * scale;
        const bottom = y0 + viewRect.height * scale;

        this.labels.forEach((label, index) => {
            const labelWidth = label.width * grow;

            // the copies whose anchor lies inside the view
            const firstCopyY = Math.ceil((y0 - label.y) / height);
            const lastCopyY = Math.floor((bottom - label.y) / height);
            const firstCopyX = Math.ceil((x0 - label.x) / width);
            const lastCopyX = Math.floor((right - label.x) / width);

            for (let copyY = firstCopyY; copyY <= lastCopyY; copyY++) {
                for (let copyX = firstCopyX; copyX <= lastCopyX; copyX++) {
                    const x = (label.x + copyX * width - x0) / scale;
                    const y = (label.y + copyY * height - y0) / scale;
                    const rect: PixelRect = [x - labelWidth / 2, y - 17 * grow, x + labelWidth / 2, y + 5 * grow];
                    if (placed.some((other) => overlaps(rect, other))) continue;

                    placed.push(rect);
                    shownTexts.add(this.labelText(label, index, copyX, copyY));
                }
            }
        });

        for (const text of this.labelsOn) {
            if (!shownTexts.has(text)) text.classList.add('off');
        }

        for (const text of shownTexts) text.classList.remove('off');
        this.labelsOn = shownTexts;
    }

    // the text element of one copy of a label, made the first time it is shown
    private labelText(label: PlacedLabel, index: number, copyX: number, copyY: number): SVGTextElement {
        const [width, height] = PROG.map.size;
        const copy = `${index}:${copyX}:${copyY}`;
        const existing = this.labelPool.get(copy);
        if (existing) return existing;

        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('class', 'area');
        text.setAttribute('x', String(label.x + copyX * width));
        text.setAttribute('y', String(label.y + copyY * height));
        text.textContent = label.text;
        this.labelsGroup.append(text);
        this.labelPool.set(copy, text);
        return text;
    }

    // a marker's drawn radius in path units (they are scaled by the map once a square is wider than 11 px, else by the
    // screen)
    private endRadius(end: LinkEnd): number {
        if (isPosition(end)) return 9;

        const style = this.options.style(this.options.markers[end]);
        const focused = this.selection?.focus === end;
        let radius = levelMarkerRadius(style, focused);
        if (style.star) {
            radius = 6.5;
            if (focused || style.big) radius = 9;
        }

        return radius + 1;
    }

    // lines run from marker edge to marker edge; one with no visible stretch left is hidden
    private placeLinks({ scale }: ViewCorner): void {
        const markerScale = Math.max(scale, 0.09);
        const marks = this.shownMarks.linkLines.marks;

        this.linkEnds.forEach(([x1, y1, startRadius, x2, y2, endRadius], index) => {
            const length = Math.hypot(x2 - x1, y2 - y1);
            const startGap = startRadius * markerScale;
            const endGap = endRadius * markerScale;
            const visible = length - startGap - endGap >= 6 * scale;
            const lines = [marks[2 * index].element, marks[2 * index + 1].element];
            for (const line of lines) line.style.display = visible ? '' : 'none';
            if (!visible) return;

            const ux = (x2 - x1) / length;
            const uy = (y2 - y1) / length;
            for (const line of lines) {
                line.setAttribute('x1', String(x1 + ux * startGap));
                line.setAttribute('y1', String(y1 + uy * startGap));
                line.setAttribute('x2', String(x2 - ux * endGap));
                line.setAttribute('y2', String(y2 - uy * endGap));
            }
        });
    }

    // markers a click revealed inside the fog get a dark halo
    private overFog(x: number, y: number, z: number): string {
        if (this.fogOn && this.options.fog?.at(this.currentLayer, x, y, z)) return ' fg';
        return '';
    }

    private kept(overlay: MapOverlay): boolean {
        if (this.isChosen(overlay)) return true;
        return !this.options.keep || this.options.keep(overlay);
    }

    // whether the selection holds an overlay
    private isChosen(overlay: MapOverlay): boolean {
        if (overlay.id === undefined) return false;
        return !!this.selection?.overlays?.has(overlay.id);
    }

    private drawLayer(): void {
        const { options, svg } = this;
        const layer = this.currentLayer;

        // fogged squares are an opaque core; a blurred, grown copy feathers the outside edge only.
        // Both are clipped to the map, so fog ends at the map border.
        let rects: FogRect[] = [];
        if (options.fog && this.fogOn) rects = options.fog.rects(layer);
        const fogParts = rects.map(toMap).flatMap(wrapRect);
        this.fogGroup.innerHTML = fogParts.map((rect) => rectHtml(...rect, 0)).join('');

        // the slight overlap leaves no seams between neighbours
        this.fogCore.innerHTML = fogParts.map((rect) => rectHtml(...rect, 0.02)).join('');

        // a layer's base image is painted the first time the layer is shown
        svg.querySelectorAll<SVGImageElement>('image:not(.reach)').forEach((image) => {
            const isCurrent = image.dataset.layer === layer;
            if (isCurrent && !image.hasAttribute('href')) {
                image.setAttribute('href', mapLayerImage(mapLayer(layer), options.fog));
            }
            image.style.display = isCurrent ? '' : 'none';
        });

        if (options.reach && !(layer in this.reachUrls)) {
            this.reachUrls[layer] = reachImage(mapLayer(layer), options.reach, options.fog);
        }

        const reachUrl = options.reach && this.reachUrls[layer];
        svg.querySelectorAll<SVGImageElement>('image.reach').forEach((image) => {
            const isShown = overlayOn.reach && !!reachUrl && image.dataset.layer === layer;
            if (isShown && image.getAttribute('href') !== reachUrl) image.setAttribute('href', reachUrl);
            image.style.display = isShown ? '' : 'none';
        });

        // with the fog shown, fogged rectangles that hold a reached column are hatched whole, never square by square
        let reachFog: FogRect[] = [];
        if (this.fogOn && options.reach) reachFog = reachedRects(options.reach[layer], rects);

        let hatchHtml = '';
        if (overlayOn.reach) {
            const hatchRects = reachFog.flatMap((rect) => wrapRect(toMap(rect)));
            hatchHtml = hatchRects.map((rect) => rectHtml(...rect, 0)).join('');
        }

        this.reachFogGroup.innerHTML = hatchHtml;

        const water = options.water?.[layer] || [];
        find(svg, '.wtr', SVGGElement).innerHTML = water
            .map(([x, y]) => {
                const [mapX, mapY] = mapXY(x, y);
                return `<rect x="${mapX - 0.5}" y="${mapY - 0.5}" width="1" height="1"/>`;
            })
            .join('');

        this.box
            .querySelectorAll<HTMLElement>('[data-role=layers] button')
            .forEach((button) => setButtonPressed(button, button.dataset.layer === layer));
        this.reachEmpty = !reachUrl && !reachFog.length;
    }

    // whether an overlay toggle has nothing to switch on the current layer
    private overlayEmpty(kind: OverlayKind): boolean {
        if (kind === 'reach') return this.reachEmpty;

        return !(this.options.overlays || []).some(
            (overlay) => overlay.kind === kind && overlay.layer === this.currentLayer && this.kept(overlay),
        );
    }

    // markers that overlap stack by relevance: the selection's focus on top, then its levels, then by style rank
    private stackRank({ marker, style }: StyledMarker): number {
        if (this.selection?.focus === marker.levelIndex) return 1e3;

        const rank = style.rank || 0;
        if (this.selection?.levels.has(marker.levelIndex)) return 100 + rank;
        return rank;
    }

    // ' hl' for a level of the selection (the stylesheet dims the others while there is one)
    private selectionClass(index: number): string {
        if (this.selection?.levels.has(index)) return ' hl';
        return '';
    }

    private draw(): void {
        const { options } = this;
        const layer = this.currentLayer;
        const selection = this.selection;

        const layerKey = `${layer}:${overlayOn.reach}`;
        if (this.drawnLayer !== layerKey) {
            this.drawnLayer = layerKey;
            this.drawLayer();
        }

        this.box.querySelectorAll<HTMLElement>('[data-ov]').forEach((button) => {
            const kind = overlayKindOf(button);
            setButtonPressed(button, overlayOn[kind]);
            button.classList.toggle('empty', this.overlayEmpty(kind));
        });

        this.homeCache = undefined;
        this.setHover(null);
        this.overlayGroup.classList.toggle('picked', !!selection);
        this.showMarks(layer);

        const levels = (options.markers || [])
            .filter((marker) => mapLayerOf(marker.z) === layer)
            .map((marker): StyledMarker => ({ marker, style: options.style(marker) }))
            .filter((level) => !level.style.gone);

        // a level filtered out is still drawn when it is the level the save is in or part of the selection
        const isDrawn = ({ marker, style }: StyledMarker): boolean => {
            if (!style.hidden || style.current) return true;
            return !!selection?.levels.has(marker.levelIndex);
        };

        const isRaised = (marker: MapMarker): boolean =>
            selection?.focus === marker.levelIndex || !!selection?.levels.has(marker.levelIndex);

        const drawnLevels = new Set(levels.filter(isDrawn).map((level) => level.marker.levelIndex));

        // the selection's levels are drawn again over the others (focus last); their places among the others only hide
        // the marker, so a selection moves no element. A level the list filter hides has no place among the others.
        const raisedLevels = levels
            .filter((level) => isDrawn(level) && isRaised(level.marker))
            .toSorted((first, second) => this.stackRank(first) - this.stackRank(second));
        const baseLevels = levels
            .filter((level) => !level.style.hidden || level.style.current)
            .toSorted((first, second) => (first.style.rank || 0) - (second.style.rank || 0));

        this.drawnMarkers = [];
        const baseMarks: MarkAttributes[] = [];

        for (const { marker, style } of baseLevels) {
            const hidden = isRaised(marker);
            if (!hidden) this.noteDrawn(marker);
            baseMarks.push(...this.levelMarkAttributes(marker, style, hidden));
        }

        const raisedMarks: MarkAttributes[] = [];

        for (const { marker, style } of raisedLevels) {
            this.noteDrawn(marker);
            raisedMarks.push(...this.levelMarkAttributes(marker, style, false));
        }

        const marks = this.shownMarks;
        marks.overlayMarks.draw(this.overlayMarkAttributes(drawnLevels));
        marks.linkLines.draw(this.linkAttributes());
        marks.towerMarks.draw(this.towerAttributes());
        marks.levelMarks.fit(baseMarks);
        marks.raisedMarks.draw(raisedMarks);

        this.drawHero();
        this.drawRing(levels.find((level) => level.style.current && isDrawn(level)));
        this.drawSteps();
        if (layer !== this.labelsLayer) this.drawLabels(layer);

        this.viewport.showCopies();
        this.hitList = null;
        this.layout();
    }

    // the area labels of a layer go on top (cullLabels makes their elements); they ignore the pointer, so markers under
    // them stay clickable
    private drawLabels(layer: string): void {
        this.labelsLayer = layer;
        this.labels = (this.options.labels || [])
            .filter((label) => mapLayerOf(label.z) === layer)
            .map((label): PlacedLabel => {
                const [x, y] = mapXY(label.x, label.y);
                return { text: label.text, x, y, width: label.text.length * 8.6 + 10 };
            });

        this.labelsGroup.replaceChildren();
        this.labelPool.clear();
        this.labelsOn = new Set();
    }

    // gates, signs, teleporters and treasures under everything else; gates, signs and gold rooms (overlay.attr) are
    // clickable through a larger invisible pad, the rest only carry a tooltip; a gate on a level's entrance
    // (overlay.merge) is drawn behind that level's marker while the marker is drawn. The ones not drawn stay in their
    // places, hidden.
    private overlayMarkAttributes(drawnLevels: Set<number>): MarkAttributes[] {
        const list: MarkAttributes[] = [];

        for (const overlay of this.options.overlays || []) {
            if (overlay.layer !== this.currentLayer) continue;

            let hidden = false;
            if (isOverlayKind(overlay.kind) && !overlayOn[overlay.kind]) hidden = true;
            if (!this.kept(overlay)) hidden = true;
            if (overlay.merge != null && drawnLevels.has(overlay.merge)) hidden = true;

            const [x, y] = mapXY(overlay.x, overlay.y);
            let state = '';
            if (this.isChosen(overlay)) state += ' chosen';
            if (overlay.done === false) state += ' miss';

            const style = placedAt(x, y);
            if (overlay.attr) {
                const [name, value] = overlay.attr;
                list.push(
                    hiddenWhen(hidden, {
                        class: 'k pad',
                        d: OVERLAY_PAD,
                        style,
                        [name]: value,
                        'data-tip': overlay.tip,
                    }),
                    hiddenWhen(hidden, {
                        class: `k ${overlay.cls}${state}`,
                        d: overlay.d,
                        style,
                        'pointer-events': 'none',
                    }),
                );
            } else {
                list.push(
                    hiddenWhen(hidden, {
                        class: `k ${overlay.cls}${state}`,
                        d: overlay.d,
                        style,
                        'data-tip': overlay.tip,
                    }),
                );
            }
        }

        return list;
    }

    // a marker's [x, y, z], or undefined for a level marker that is not drawn
    private endPoint(end: LinkEnd): MapPoint | undefined {
        if (isPosition(end)) return { x: end[0], y: end[1], z: end[2] };
        return this.options.markers[end];
    }

    // lines from the selected level to the levels it requires (solid) and the ones it unlocks (dashed), on this layer,
    // under the towers and markers; placeLinks sets their ends for the current zoom
    private linkAttributes(): MarkAttributes[] {
        const layer = this.currentLayer;
        const [width, height] = PROG.map.size;
        const isGone = (end: LinkEnd): boolean =>
            !isPosition(end) && this.options.style(this.options.markers[end]).gone;
        const list: MarkAttributes[] = [];
        this.linkEnds = [];
        this.linkReach = 0;

        for (const [from, to, kind] of this.selection?.links || []) {
            const start = this.endPoint(from);
            const finish = this.endPoint(to);
            if (!start || !finish || mapLayerOf(start.z) !== layer || mapLayerOf(finish.z) !== layer) continue;
            if (isGone(from) || isGone(to)) continue;

            // a dark halo under each line keeps it readable on any terrain
            list.push({ class: 'link halo' }, { class: `link ${kind}` });

            // the far end is placed in the copy of the map nearest the near end, so a line over the seam runs the short
            // way
            const [x1, y1] = mapXY(start.x, start.y);
            const [x2, y2] = mapXY(finish.x, finish.y);
            const farX = x1 + wrapDelta(x2 - x1, width);
            const farY = y1 + wrapDelta(y2 - y1, height);
            this.linkEnds.push([x1, y1, this.endRadius(from), farX, farY, this.endRadius(to)]);
            this.linkReach = Math.max(this.linkReach, -farX, farX - width, -farY, farY - height);
        }

        return list;
    }

    private towerAttributes(): MarkAttributes[] {
        const list: MarkAttributes[] = [];

        for (const tower of this.options.towers || []) {
            if (mapLayerOf(tower.z) !== this.currentLayer) continue;

            const [x, y] = mapXY(tower.x, tower.y);
            let classes = 'tw';
            if (tower.activated) classes += ' on';
            if (this.selection?.tower === tower.towerIndex) classes += ' hl';
            classes += this.overFog(tower.x, tower.y, tower.z);
            list.push({ class: classes, style: placedAt(x, y), 'data-tw': tower.towerIndex, 'data-tip': tower.tip });
        }

        return list;
    }

    // the square of the Freezer on a level's entrance, behind its marker
    private freezerAttributes(marker: MapMarker, ice: MapFreezer, position: string, hidden: boolean): MarkAttributes {
        const chosen = this.selection?.overlays?.has(ice.id);
        let classes = 'k gt';
        if (ice.open) classes += ' open';
        if (chosen) classes += ' chosen';
        else classes += this.selectionClass(marker.levelIndex);
        classes += this.overFog(marker.x, marker.y, marker.z);

        const radius = this.endRadius(marker.levelIndex) + 0.5;
        return hiddenWhen(hidden, {
            class: classes,
            d: `M${-radius} ${-radius}h${2 * radius}v${2 * radius}h${-2 * radius}Z`,
            style: position,
            'data-i': marker.levelIndex,
        });
    }

    // the marks of a level in paint order: the Freezer on its entrance, the marker, the achievement badge. A level that
    // is not drawn keeps its marks, hidden.
    private levelMarkAttributes(marker: MapMarker, style: MarkerStyle, hidden: boolean): MarkAttributes[] {
        const selection = this.selection;
        const [x, y] = mapXY(marker.x, marker.y);
        const focused = selection?.focus === marker.levelIndex;
        const big = focused || style.big;
        const position = placedAt(x, y);
        let classes = this.selectionClass(marker.levelIndex);
        if (selection?.frontier?.has(marker.levelIndex)) classes += ' fr';
        if (style.ring) classes += ' ring';
        classes += this.overFog(marker.x, marker.y, marker.z);

        const list: MarkAttributes[] = [];
        if (marker.ice) list.push(this.freezerAttributes(marker, marker.ice, position, hidden || !overlayOn.gates));
        if (style.star) {
            list.push(
                hiddenWhen(hidden, {
                    class: `lv k star${classes}`,
                    d: big ? STAR_BIG : STAR,
                    style: position,
                    fill: style.color,
                    'data-i': marker.levelIndex,
                }),
            );
        } else {
            const shape = SHAPES[style.shape] || SHAPES.circle;
            list.push(
                hiddenWhen(hidden, {
                    class: `lv k${classes}`,
                    d: shape.path(levelMarkerRadius(style, focused)),
                    style: position,
                    fill: style.color,
                    'data-i': marker.levelIndex,
                }),
            );
        }

        if (style.achievement) {
            list.push(
                hiddenWhen(hidden, {
                    class: `k achb${this.selectionClass(marker.levelIndex)}`,
                    d: achievementBadgePath(big ? 7 : 5),
                    style: position,
                }),
            );
        }

        return list;
    }

    // a drawn level marker, for the tooltip of overlapping ones
    private noteDrawn(marker: MapMarker): void {
        const [x, y] = mapXY(marker.x, marker.y);
        this.drawnMarkers.push({ x, y, levelIndex: marker.levelIndex });
    }

    private drawHero(): void {
        const marks = this.shownMarks;
        const hero = this.options.hero;
        if (!hero || mapLayerOf(hero.z) !== this.currentLayer) {
            marks.heroMark.hide();
            return;
        }

        const [x, y] = mapXY(hero.x, hero.y);
        marks.heroMark.set({ class: 'k hero', d: HERO_PATH, style: placedAt(x, y) });
    }

    // the ring round the drawn level the save is in, undefined when there is none
    private drawRing(current: StyledMarker | undefined): void {
        const marks = this.shownMarks;
        if (!current) {
            marks.ringMark.hide();
            return;
        }

        const { marker, style } = current;
        const [x, y] = mapXY(marker.x, marker.y);
        const big = this.selection?.focus === marker.levelIndex || style.big;
        marks.ringMark.set({ class: 'k cur', d: SHAPES.circle.path(big ? 11 : 9), style: placedAt(x, y) });
    }

    // the steps of the unlock chain are numbered on top of the markers
    private drawSteps(): void {
        const stepMarks = this.shownMarks.stepMarks;
        let count = 0;

        for (const [end, stepNumber] of this.selection?.steps || []) {
            const point = this.endPoint(end);
            if (!point || mapLayerOf(point.z) !== this.currentLayer) continue;
            if (!isPosition(end) && this.options.style(this.options.markers[end]).gone) continue;

            const [x, y] = mapXY(point.x, point.y);
            const badge = stepMarks.at(count);
            count++;
            badge.set({ class: 'bd', style: placedAt(x, y) });

            const label = badge.element.lastElementChild;
            if (label && label.textContent !== String(stepNumber)) label.textContent = String(stepNumber);
        }

        stepMarks.hideFrom(count);
    }

    // whether the map can show a layer: the fog has uncovered it
    private canShow(layer: string): boolean {
        return !this.known || this.known.includes(layer);
    }

    // switches the layer (not to one the fog has not uncovered); onLayer lets the lists follow
    private showLayer(layer: string): void {
        this.currentLayer = layer;
        this.keep.layer = layer;
        this.draw();
        this.options.onLayer?.(layer);
    }

    private wireControls(): void {
        const { box, options } = this;
        box.querySelectorAll<HTMLElement>('[data-z]').forEach((button) =>
            button.addEventListener('click', () => this.viewport.zoom(Number(button.dataset.z))),
        );

        const heroButton = find(box, '[data-hero]', HTMLElement);
        heroButton.hidden = !options.hero;
        heroButton.addEventListener('click', () => {
            const hero = options.hero;
            if (!hero) return;

            if (this.selection) this.select(null);
            this.fitPoints([[hero.x, hero.y, hero.z]]);
        });

        box.querySelectorAll<HTMLElement>('[data-role=layers] button').forEach((button) =>
            button.addEventListener('click', () => this.setLayer(button.dataset.layer ?? '')),
        );
        find(box, '[data-role=ovl]', HTMLElement).hidden = !options.overlays?.length && !options.reach;
        box.querySelectorAll<HTMLElement>('[data-ov]').forEach((button) => {
            const kind = overlayKindOf(button);
            button.hidden = kind === 'reach' && !options.reach;
            button.addEventListener('click', () => this.setOverlay(kind, !overlayOn[kind]));
        });
    }

    // the marker under the pointer is highlighted by a class, which the copies of the map follow (:hover does not reach
    // them)
    private setHover(element: Element | null): void {
        if (element === this.hover) return;

        this.hover?.classList.remove('hv');
        this.hover = element;
        this.hover?.classList.add('hv');
    }

    // the tooltips of the drawn markers that overlap under the cursor, up to eight
    private nearTips(event: MouseEvent, html: string): string {
        const { scale } = this.viewport.scale();
        const point = this.viewport.toWorld(event);
        const [width, height] = PROG.map.size;
        const reach = 7 * Math.max(scale, 0.09);
        const near = this.drawnMarkers.filter((marker) => {
            const dx = wrapDelta(marker.x - point.x, width);
            const dy = wrapDelta(marker.y - point.y, height);
            return Math.hypot(dx, dy) <= reach;
        });

        if (near.length <= 1) return html;

        let tips = near
            .slice(0, 8)
            .map((marker) => this.options.markers[marker.levelIndex].tip)
            .join('<hr>');
        if (near.length > 8) tips += `<hr><span class="muted">${near.length - 8} more</span>`;
        return tips;
    }

    private showTip(event: MouseEvent): void {
        const { svg, tip } = this;
        if (svg.classList.contains('drag')) {
            this.setHover(null);
            return;
        }

        const target = this.pick(event)?.closest<SVGElement>('[data-tip],[data-i]');
        if (target?.matches('.lv')) this.setHover(target);
        else this.setHover(null);
        if (!target) {
            tip.style.display = 'none';
            return;
        }

        const boxRect = this.box.getBoundingClientRect();
        let html = target.dataset.tip ?? '';

        // a level's tooltip is made when it is shown; markers that overlap under the cursor are listed together
        const markerIndex = target.dataset.i;
        if (markerIndex !== undefined) html = this.nearTips(event, this.options.markers[Number(markerIndex)].tip);
        if (html !== this.tipHtml) {
            this.tipHtml = html;
            tip.innerHTML = html;
        }

        tip.style.display = 'block';

        const cursorX = event.clientX - boxRect.left;
        const cursorY = event.clientY - boxRect.top;
        const tipHeight = tip.offsetHeight;
        tip.style.left = Math.max(8, Math.min(boxRect.width - tip.offsetWidth - 8, cursorX + 14)) + 'px';
        let top = cursorY + 14;
        if (top + tipHeight > boxRect.height - 8) top = Math.max(8, cursorY - 10 - tipHeight);
        tip.style.top = top + 'px';
    }

    // an empty click closes the panel at once (a double-click then zooms with it closed)
    private clicked(event: MouseEvent): void {
        if (this.viewport.wasDragged || event.detail > 1) return;

        const target = this.pick(event);
        const tower = target?.closest<SVGElement>('[data-tw]');
        const level = target?.closest<SVGElement>('[data-i]');
        const gate = target?.closest<SVGElement>('[data-gate]');
        const sign = target?.closest<SVGElement>('[data-sign]');
        const gateTower = target?.closest<SVGElement>('[data-gtw]');
        if (tower && this.onTower) this.onTower(Number(tower.dataset.tw));
        else if (level && this.onPick) this.onPick(Number(level.dataset.i));
        else if (gate && this.onGate) this.onGate(Number(gate.dataset.gate));
        else if (sign && this.onSign) this.onSign(Number(sign.dataset.sign));
        else if (gateTower && this.onTower) this.onTower(Number(gateTower.dataset.gtw));
        else if (this.selection) this.select(null);
    }

    private wirePointer(): void {
        const { svg } = this;
        svg.addEventListener('mousemove', (event) => this.showTip(event));
        svg.addEventListener('mouseleave', () => {
            this.tip.style.display = 'none';
            this.setHover(null);
        });

        svg.addEventListener('click', (event) => this.clicked(event));
    }

    private settle(): void {
        if (this.sized) return;

        this.sized = true;
        this.waiting.splice(0).forEach((run) => run());
    }

    // frames the selection's points on the current layer: a level selection zooms in when the map is far out, so
    // neighbouring requirements and their lines separate
    private frameSelection(selection: MapSelection): void {
        const points = (selection.points || [])
            .filter((point) => mapLayerOf(point[2]) === this.currentLayer)
            .map((point) => mapXY(point[0], point[1]));
        if (!points.length) return;

        const box = boxOf(points);
        const { rect: viewRect, scale } = this.viewport.scale();
        const frame: Insets = { ...this.insets(), m: FRAME_MARGIN };
        if (selection.links && (selection.exact || viewRect.width * scale > MIN_BOX * 2.5)) {
            let min = MIN_BOX;
            if (selection.steps?.length && !selection.exact) min = MIN_CHAIN_BOX;
            this.viewport.fit(padBox(box, min), frame);
        } else {
            this.viewport.reveal(box, frame);
        }
    }

    redraw(): void {
        this.draw();
    }

    // switches an overlay toggle (remembered like a click); returns whether it was on
    setOverlay(kind: OverlayKind, enabled: boolean): boolean {
        const wasEnabled = overlayOn[kind];
        if (wasEnabled === enabled) return wasEnabled;

        overlayOn[kind] = enabled;
        setPreference('mapOverlays', JSON.stringify(overlayOn));
        this.draw();
        return wasEnabled;
    }

    // pulses the overlay marks of one class (path classes) that are not found yet, on the current layer
    flash(className: string): void {
        const marks = [...this.shownMarks.root.querySelectorAll(`.k.miss.${className}:not([display])`)];
        marks.forEach((mark) => mark.classList.add('pulse'));
        setTimeout(() => marks.forEach((mark) => mark.classList.remove('pulse')), 2400);
    }

    // the layer and view, to come back to with setView
    getView(): MapViewState {
        return {
            layer: this.currentLayer,
            vb: this.keep.vb && { ...this.keep.vb },
            moved: !!this.keep.moved,
        };
    }

    setView(view: MapViewState): void {
        if (view.layer !== this.currentLayer && this.canShow(view.layer)) this.showLayer(view.layer);

        if (view.vb) this.viewport.goTo(view.vb, view.moved);
        else this.viewport.reset();
    }

    setKey(html: string | undefined): void {
        this.keyBox.innerHTML = html || '';
        this.keyShown = !!html;
        this.placePanel();
        this.viewport.resize();
    }

    setLayer(layer: string): void {
        if (layer === this.currentLayer || !this.canShow(layer)) return;

        this.currentLayer = layer;
        this.keep.layer = layer;
        this.draw();
        this.viewport.resize();
        this.options.onLayer?.(layer);
    }

    get busy(): boolean {
        return this.box.isConnected && this.viewport.busy;
    }

    // runs run() once the box has been laid out (its first resize), at once when it has
    ready(run: () => void): void {
        if (this.sized) {
            run();
            return;
        }

        this.waiting.push(run);
    }

    get layer(): string {
        return this.currentLayer;
    }

    get layers(): string[] {
        return AREA_LAYERS.filter((key) => PROG.map.layers.some((layer) => layer.key === key) && this.canShow(key));
    }

    reset(): void {
        if (this.box.isConnected) this.viewport.reset();
    }

    get open(): boolean {
        return !!this.selection && this.box.isConnected;
    }

    // selects a level, tower or overlay and frames it, or clears the selection with null
    select(selection: MapSelection | null, how: SelectHow = {}): void {
        const { panel, options } = this;
        const inPanel = panel.contains(document.activeElement);

        // the level in a selected Freezer is selected with it
        if (selection) {
            const holdsChosenIce = (marker: MapMarker): boolean =>
                marker.ice !== undefined && !!selection.overlays?.has(marker.ice.id);
            const iceLevels = (options.markers || []).filter(holdsChosenIce).map((marker) => marker.levelIndex);
            this.selection = { ...selection, levels: new Set([...selection.levels, ...iceLevels]) };
        } else {
            this.selection = null;
        }

        panel.innerHTML = selection?.html || '';
        panel.style.display = selection?.html ? '' : 'none';

        // a level on a layer the fog has not uncovered keeps the current layer
        const before = this.currentLayer;
        if (selection?.z != null && !how.still && this.canShow(mapLayerOf(selection.z))) {
            this.currentLayer = mapLayerOf(selection.z);
            this.keep.layer = this.currentLayer;
        }

        this.placePanel();
        this.draw();
        if (this.currentLayer !== before) options.onLayer?.(this.currentLayer);

        panel.querySelector('[data-close]')?.addEventListener('click', () => this.select(null));
        if (selection && !how.still && !how.keepFocus) {
            if (!inPanel && document.activeElement !== document.body) this.opener = focusableOf(document.activeElement);
            panel.querySelector<HTMLElement>('.hd b')?.focus({ preventScroll: true });
        }

        if (!selection) {
            options.onClose?.();
            if (this.opener?.isConnected && (inPanel || document.activeElement === document.body)) {
                this.opener.focus({ preventScroll: true });
            }

            this.opener = null;
        }

        if (selection && !how.still) this.frameSelection(selection);
    }

    // zooms to world points [x, y, z], first moving to their layer when none is on the current one
    fitPoints(points: Position[]): void {
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

export function mapInit(id: string, options: MapOptions): MapView {
    const map = new MapView(id, options);
    activeMap = map;
    return map;
}
