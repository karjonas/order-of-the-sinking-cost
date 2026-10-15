// The state of one drawn progress view, shared by its parts: the model's data, the goal the list and the map show with
// its levels, the list filter, the map and the open panel (VIEWER.md "The page (viewer)")
import type { Fog } from '../fog.ts';
import type { MapView, MapOptions, MapOverlay, MapViewState, SelectHow } from '../map/map-view.ts';
import type { OverlayKind } from '../map/map-html.ts';
import { PROG } from '../data.ts';
import { listAllLayers, state } from '../shared.ts';
import type { PanelKey, PanelKind, ProgressFilters } from '../shared.ts';
import { FOG_LAYER_KEYS, mapLayerOf } from '../model/layers.ts';
import type { GoalLevel, GoalView } from '../model/goals-view.ts';
import type { ProgressModel } from '../model/progress-model.ts';
import type { ShownProgress } from '../model/progress.ts';
import type { LevelState } from '../model/unlocking.ts';
import type { Area, Freezer, Position, ProgressLevel, Sign, Teleporter } from '../types.ts';
import { panelKeep, setHash } from './hash.ts';

/** The key of a state chip of the list. */
export type StateChip = 'playable' | 'partial' | 'blocked' | 'locked' | 'solved';

/** The state chips of the list: key, label and the level states each one keeps. */
export const STATE_CHIPS: Array<[key: StateChip, label: string, states: LevelState[]]> = [
    ['playable', 'Playable', ['unlocked', 'visited']],
    ['partial', 'Partially solved', ['partial']],
    ['blocked', 'Not reachable', ['blocked']],
    ['locked', 'Locked', ['locked']],
    ['solved', 'Solved', ['solved']],
];

export function chipOfState(levelState: LevelState): StateChip {
    for (const [key, , states] of STATE_CHIPS) {
        if (states.includes(levelState)) return key;
    }

    throw new Error(`No state chip keeps ${levelState}`);
}

/** A level of the goal as the list shows it: the goal's levels by group, and the solved ones. */
export interface ListedLevel {
    i: number;
    group: GoalLevel['group'] | 'solved';
    role: GoalLevel['role'];
    leadsTo: string;
    onPlan: boolean;
}

/** The view and the overlays a totals row turned on, which a second click on it goes back to. */
export interface FindBack {
    view: MapViewState;
    turned: Set<OverlayKind>;
}

/** Shows the panel of a level, tower, Freezer or sign. */
export type PanelSelector = (id: number, how?: SelectHow) => void;

// a level whose entrance is on the cell of a Freezer is drawn as one marker with the Freezer behind it
const cellKey = (position: Position): string => position.map((coordinate) => Math.round(coordinate)).join();

export class PanelContext {
    model: ProgressModel;
    status: ProgressModel['status'];
    progress: ShownProgress;
    levels: ProgressLevel[];
    teleporters: Teleporter[];
    fog: Fog;
    hide: boolean;
    filters: ProgressFilters;
    camp: string;
    freezers: Freezer[];
    signs: Sign[];
    areas: Area[];

    // the area name of each Freezer asked about, for this draw
    gateAreas = new Map<number, string | null>();

    // per level, the Freezer on its entrance cell; per such Freezer, its level
    iceOf: Array<number | undefined>;

    iceLevel = new Map<number, number>();

    // per tower name, its first tower
    towerAt = new Map<number, number>();

    // the level names in lower case, for the search
    lowNames: string[];

    // The goal the list and the map show, and its levels: the unsolved ones in the model's order, then the solved
    // ones, which the list keeps only while the Solved chip is on
    goal: GoalView | null = null;

    entries = new Map<number, ListedLevel>();
    goalIds: number[] = [];

    // whether the list filter keeps each level, as of the last apply
    matches = new Uint8Array(0);

    // the goal's levels the filter keeps; the ones the list shows; the ones on the map's other layers
    matched: number[] = [];

    list: number[] = [];
    others: number[] = [];

    // the list shows the levels on the map's layer; a search, or the All layers switch, shows every layer
    mapLayer: string | null = null;

    // the level marked in the list
    selected: number | null = null;

    map: MapView | null = null;
    mapOptions: MapOptions | null = null;

    // the open panel as [kind, id]; the panels Back returns to; the points the open panel's chain frames
    current: PanelKey | null = null;

    back: PanelKey[] = [];
    chainPoints: Position[] = [];

    // the view and the overlays a totals row turned on, which a second click on it goes back to
    findBack: FindBack | null = null;

    // the map's overlays, and the panel of each node kind (both set with the map)
    overlays: () => MapOverlay[] = () => [];

    selectors: Record<PanelKind, PanelSelector> = {
        level: () => {},
        tower: () => {},
        gate: () => {},
        sign: () => {},
    };

    constructor(model: ProgressModel) {
        if (state.camp === null) throw new Error('A progress view needs a campaign');

        this.model = model;
        this.status = model.status;
        this.progress = model.progress;
        this.levels = model.levels;
        this.teleporters = model.teleporters;
        this.fog = model.fog;
        this.hide = model.hide;
        this.filters = model.F;
        this.camp = state.camp;
        this.freezers = PROG.freezers;
        this.signs = PROG.signs || [];
        this.areas = PROG.areas || [];

        const gateAtCell = new Map(
            model.gates.map((freezerIndex): [string, number] => [cellKey(this.freezers[freezerIndex].p), freezerIndex]),
        );
        this.iceOf = this.levels.map((level) => gateAtCell.get(cellKey(level.p)));
        this.iceOf.forEach((freezerIndex, levelIndex) => {
            if (freezerIndex !== undefined) this.iceLevel.set(freezerIndex, levelIndex);
        });

        this.progress.towers.forEach((tower, towerIndex) => {
            if (!this.towerAt.has(tower.t)) this.towerAt.set(tower.t, towerIndex);
        });

        this.lowNames = this.levels.map((level) => level.n.toLowerCase());
    }

    hiddenCount(): number {
        return this.progress.hidden.filter(Boolean).length;
    }

    // a level names its area (the model's per-save pick; the nearest one outside every area box) only while that area
    // is shown
    areaOf(levelIndex: number): number | null {
        const area = this.model.levelArea[levelIndex];
        if (area == null || !this.model.areaShown(area)) return null;
        return area;
    }

    // a Freezer is named by the area it stands in while that area is shown, else by its position
    gateArea(freezerIndex: number): string | null {
        let area = this.gateAreas.get(freezerIndex);
        if (area === undefined) {
            area = this.model.gateArea(freezerIndex);
            this.gateAreas.set(freezerIndex, area);
        }

        return area;
    }

    gateAt(freezerIndex: number): string {
        const position = this.freezers[freezerIndex].p;
        return `${position[0]}, ${position[1]}`;
    }

    gateName(freezerIndex: number): string {
        return this.gateArea(freezerIndex) ?? this.gateAt(freezerIndex);
    }

    gateShown(freezer: Freezer): boolean {
        return this.model.shownAt(FOG_LAYER_KEYS[freezer.l], freezer.p);
    }

    layerOf(levelIndex: number): string {
        return mapLayerOf(this.levels[levelIndex].p[2]);
    }

    inView(levelIndex: number): boolean {
        return !this.mapLayer || this.layerOf(levelIndex) === this.mapLayer;
    }

    listsEveryLayer(): boolean {
        return listAllLayers || !!this.filters.q;
    }

    narrowed(): boolean {
        const filters = this.filters;
        return !!filters.q || filters.states.length > 0 || filters.tower !== '' || filters.area !== '';
    }

    // whether the search and the tower and area chips keep a level
    keptByNarrowing(levelIndex: number): boolean {
        const level = this.levels[levelIndex];
        const filters = this.filters;
        if (this.progress.hidden[levelIndex]) return false;
        if (filters.q && !this.lowNames[levelIndex].includes(filters.q)) return false;
        if (filters.tower !== '' && level.t !== this.progress.towers[Number(filters.tower)]?.t) return false;
        if (filters.area !== '' && String(this.model.levelArea[levelIndex] ?? '') !== filters.area) return false;
        return true;
    }

    // a level is listed when it is one of the goal's and the chips keep it; with no state chip on, the solved are left out
    matchNow(levelIndex: number): boolean {
        if (!this.entries.has(levelIndex) || !this.keptByNarrowing(levelIndex)) return false;

        const chip = chipOfState(this.progress.state[levelIndex]);
        if (this.filters.states.length) return this.filters.states.includes(chip);
        return chip !== 'solved';
    }

    computeMatches(): void {
        this.matches = Uint8Array.from(this.levels, (_level, levelIndex) => (this.matchNow(levelIndex) ? 1 : 0));
    }

    match(levelIndex: number): boolean {
        return this.matches[levelIndex] === 1;
    }

    // a level of the goal, which the list shows
    entryOf(levelIndex: number): ListedLevel {
        const entry = this.entries.get(levelIndex);
        if (!entry) throw new Error(`Level ${levelIndex} is not one of the goal's`);
        return entry;
    }

    loadGoal(): void {
        this.goal = this.model.goalFor(this.filters.goal);
        this.entries = new Map();
        if (this.goal) {
            for (const entry of this.model.goalLevels(this.goal)) this.entries.set(entry.i, entry);
            for (const solved of this.model.goalSolved(this.goal)) {
                this.entries.set(solved, { i: solved, group: 'solved', role: null, leadsTo: '', onPlan: true });
            }
        }

        this.goalIds = [...this.entries.keys()];
    }

    // a one-of level off the goal's cheapest plans, listed after the ones on them
    isOffPlan(levelIndex: number): boolean {
        const entry = this.entryOf(levelIndex);
        return entry.role === 'one' && !entry.onPlan;
    }

    started(levelIndex: number): boolean {
        const levelState = this.progress.state[levelIndex];
        return levelState === 'visited' || levelState === 'partial';
    }

    towerOf(levelIndex: number): number {
        const towerName = this.levels[levelIndex].t;
        if (!towerName) return -1;
        return this.towerAt.get(towerName) ?? -1;
    }

    towerShown(levelIndex: number): boolean {
        const towerIndex = this.towerOf(levelIndex);
        return towerIndex >= 0 && !this.progress.towerHidden[towerIndex];
    }

    // keeps the open panel for the campaign and names it in the address
    remember(key: PanelKey): void {
        panelKeep[this.camp] = key;
        this.current = key;

        const [kind, id] = key;
        let target = String(id);
        if (kind === 'level') target = encodeURIComponent(this.levels[id].n);
        setHash(kind + '=' + target);
    }

    open([kind, id]: PanelKey, how?: SelectHow): void {
        this.selectors[kind](id, how);
    }
}
