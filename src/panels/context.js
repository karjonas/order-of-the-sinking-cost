// The state of one drawn progress view, shared by its parts: the model's data, the goal the list and the map show with
// its levels, the list filter, the map and the open panel (VIEWER.md "The page (viewer)")
import { PROG } from '../data.js';
import { listAllLayers, state } from '../shared.js';
import { FOG_LAYER_KEYS, mapLayerOf } from '../model/layers.js';
import { panelKeep, setHash } from './hash.js';

// The state chips of the list: key, label and the level states each one keeps
export const STATE_CHIPS = [
    ['playable', 'Playable', ['unlocked', 'visited']],
    ['partial', 'Partially solved', ['partial']],
    ['blocked', 'Not reachable', ['blocked']],
    ['locked', 'Locked', ['locked']],
    ['solved', 'Solved', ['solved']],
];
export const chipOfState = (levelState) => STATE_CHIPS.find(([, , states]) => states.includes(levelState))[0];

// a level whose entrance is on the cell of an ice gate is drawn as one marker with the gate behind it
const cellKey = (position) => position.map(Math.round).join();

export class PanelContext {
    constructor(model) {
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
        // the area name of each ice gate asked about, for this draw
        this.gateAreas = new Map();
        const gateAtCell = new Map(model.gates.map((fi) => [cellKey(this.freezers[fi].p), fi]));
        // per level, the ice gate on its entrance cell; per such gate, its level
        this.iceOf = this.levels.map((level) => gateAtCell.get(cellKey(level.p)));
        this.iceLevel = new Map(this.iceOf.flatMap((fi, i) => (fi == null ? [] : [[fi, i]])));
        // per tower name, its first tower
        this.towerAt = new Map();
        this.progress.towers.forEach((tower, ti) => {
            if (!this.towerAt.has(tower.t)) this.towerAt.set(tower.t, ti);
        });
        // the level names and set names in lower case, for the search
        this.lowNames = this.levels.map((level) => level.n.toLowerCase());
        this.lowSets = (PROG.sets || []).map((set) => set.name.toLowerCase());
        // The goal the list and the map show, and its levels: the unsolved ones in the model's order, then the solved
        // ones, which the list keeps only while the Solved chip is on
        this.goal = null;
        this.entries = new Map();
        this.goalIds = [];
        // whether the list filter keeps each level, as of the last apply
        this.matches = null;
        // the goal's levels the filter keeps; the ones the list shows; the ones on the map's other layers
        this.matched = [];
        this.list = [];
        this.others = [];
        // the list shows the levels on the map's layer; a search, or the All layers switch, shows every layer
        this.mapLayer = null;
        // the level marked in the list
        this.selected = null;
        this.map = null;
        this.mapOptions = null;
        // the open panel as [kind, id]; the panels Back returns to; the points the open panel's chain frames
        this.current = null;
        this.back = [];
        this.chainPoints = [];
        // the view and the overlays a totals row turned on, which a second click on it goes back to
        this.findBack = null;
        // the map's overlays, and the panel of each node kind (both set with the map)
        this.overlays = () => [];
        this.selectors = { level: () => {}, tower: () => {}, gate: () => {}, sign: () => {} };
    }

    hiddenCount() {
        return this.progress.hidden.filter(Boolean).length;
    }
    // level i names its area (the model's per-save pick; the nearest one outside every area box) only while that area
    // is shown
    areaOf(i) {
        const area = this.model.levelArea[i];
        if (area == null || !this.model.areaShown(area)) return null;
        return area;
    }
    // an ice gate is named by the area it stands in while that area is shown, else by its position
    gateArea(fi) {
        if (!this.gateAreas.has(fi)) this.gateAreas.set(fi, this.model.gateArea(fi));
        return this.gateAreas.get(fi);
    }
    gateAt(fi) {
        const position = this.freezers[fi].p;
        return `${position[0]}, ${position[1]}`;
    }
    gateName(fi) {
        return this.gateArea(fi) ?? this.gateAt(fi);
    }
    gateShown(freezer) {
        return this.model.shownAt(FOG_LAYER_KEYS[freezer.l], freezer.p);
    }
    layerOf(i) {
        return mapLayerOf(this.levels[i].p[2]);
    }
    inView(i) {
        return !this.mapLayer || this.layerOf(i) === this.mapLayer;
    }
    listsEveryLayer() {
        return listAllLayers || !!this.filters.q;
    }
    narrowed() {
        const filters = this.filters;
        return !!filters.q || filters.states.length > 0 || filters.tower !== '' || filters.area !== '';
    }
    // whether the search and the tower and area chips keep a level
    keptByNarrowing(i) {
        const level = this.levels[i];
        const filters = this.filters;
        if (this.progress.hidden[i]) return false;
        if (filters.q && !this.lowNames[i].includes(filters.q)) {
            if (!(level.set && this.lowSets[level.set[0]].includes(filters.q))) return false;
        }
        if (filters.tower !== '' && level.t !== this.progress.towers[filters.tower]?.t) return false;
        if (filters.area !== '' && String(this.model.levelArea[i] ?? '') !== filters.area) return false;
        return true;
    }
    // a level is listed when it is one of the goal's and the chips keep it; with no state chip on, the solved are left out
    matchNow(i) {
        if (!this.entries.has(i) || !this.keptByNarrowing(i)) return false;
        const chip = chipOfState(this.progress.state[i]);
        if (this.filters.states.length) return this.filters.states.includes(chip);
        return chip !== 'solved';
    }
    computeMatches() {
        this.matches = Uint8Array.from(this.levels, (level, i) => this.matchNow(i));
    }
    match(i) {
        return this.matches[i] === 1;
    }
    loadGoal() {
        this.goal = this.model.goalFor(this.filters.goal);
        this.entries = new Map();
        if (this.goal) {
            for (const entry of this.model.goalLevels(this.goal)) this.entries.set(entry.i, entry);
            for (const i of this.model.goalSolved(this.goal))
                this.entries.set(i, { i, group: 'solved', role: null, leadsTo: '', onPlan: true });
        }
        this.goalIds = [...this.entries.keys()];
    }
    // a one-of level off the goal's cheapest plans waits under a toggle
    isOffPlan(i) {
        const entry = this.entries.get(i);
        return entry.role === 'one' && !entry.onPlan;
    }
    started(i) {
        const levelState = this.progress.state[i];
        return levelState === 'visited' || levelState === 'partial';
    }
    towerOf(i) {
        const towerName = this.levels[i].t;
        if (!towerName) return -1;
        return this.towerAt.get(towerName) ?? -1;
    }
    towerShown(i) {
        const ti = this.towerOf(i);
        return ti >= 0 && !this.progress.towerHidden[ti];
    }
    // keeps the open panel for the campaign and names it in the address
    remember(key) {
        this.current = panelKeep[this.camp] = key;
        const [kind, id] = key;
        let target = id;
        if (kind === 'level') target = encodeURIComponent(this.levels[id].n);
        setHash(kind + '=' + target);
    }
    open([kind, id], how) {
        return this.selectors[kind](id, how);
    }
}
