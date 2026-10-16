// State shared across modules; the ones other modules change have setters
import type { SaveEntry } from './files.ts';
import type { ProgressModel } from './model/progress-model.ts';

/** A remembered setting in localStorage (or the Storage named by `store`); null when storage is unavailable. */
export const readPreference = (
    key: string,
    store: 'localStorage' | 'sessionStorage' = 'localStorage',
): string | null => {
    try {
        return globalThis[store].getItem(key);
    } catch {
        return null;
    }
};

/** Remembers a setting in localStorage (or the Storage named by `store`); nothing happens when storage is unavailable. */
export const setPreference = (
    key: string,
    value: string,
    store: 'localStorage' | 'sessionStorage' = 'localStorage',
): void => {
    try {
        globalThis[store].setItem(key, value);
    } catch {}
};

/**
 * What the page shows and where it came from: the save files by path, the campaign shown (null for none), the key of the
 * last drawn view, why the last files given opened nothing (`loadError`, shown under the banner until a campaign status
 * loads), whether the campaign was picked by hand and whether the folder picker could not open (so the banner offers the
 * other ways in).
 */
export interface PageState {
    files: Map<string, SaveEntry>;
    camp: string | null;
    rendered: string | null;
    pickerHelp: boolean;
    loadError?: string | null;
    campPicked?: boolean;
}

/** The page's state. */
export const state: PageState = { files: new Map(), camp: null, rendered: null, pickerHelp: false };

/** The totals rows of the sidebar that frame the things not found yet on the map. */
export type FindKind = 'signs' | 'tps' | 'logs';

export const isFindKind = (value: string): value is FindKind =>
    value === 'signs' || value === 'tps' || value === 'logs';

/**
 * The narrowing of the list and the map of one campaign. goal: the key of the goal the list and the map show, '' for the
 * active one; states: the state chips that narrow the list; tower and area: the chips of a tower and an area; find: the
 * totals row (signs, tps, logs) whose missing things the map is framed on.
 */
export interface ProgressFilters {
    q: string;
    goal: string;
    states: string[];
    tower: string;
    area: string;
    find: FindKind | '';
}

/** The narrowing of each campaign, by campaign name. */
export const progressFilters: Record<string, ProgressFilters> = {};

/** The kinds of thing the map's panel opens for. */
export type PanelKind = 'level' | 'tower' | 'gate' | 'sign';

/** An open panel: its kind and the index of its level, tower, Freezer or sign. */
export type PanelKey = [kind: PanelKind, id: number];

/** The results list follows the map's layer unless this is on. */
export let listAllLayers = readPreference('listAllLayers') === '1';

export const setListAllLayers = (value: boolean): void => {
    listAllLayers = value;
};

/** The fogged levels the viewer clicked open, by campaign name. */
export const revealed: Record<string, Set<number>> = {};

/** The levels a campaign has revealed. */
export function revealedOf(camp: string): Set<number> {
    let levels = revealed[camp];
    if (!levels) {
        levels = new Set();
        revealed[camp] = levels;
    }

    return levels;
}

/** The narrowing of a campaign. */
export function filtersOf(camp: string): ProgressFilters {
    let filters = progressFilters[camp];
    if (!filters) {
        filters = { q: '', goal: '', states: [], tower: '', area: '', find: '' };
        progressFilters[camp] = filters;
    }

    return filters;
}

/** Drops the search text and the state, tower and area chips; the goal and the totals row stay. */
export function clearNarrowing(filters: ProgressFilters): void {
    Object.assign(filters, { q: '', states: [], tower: '', area: '' });
}

/** Whether spoilers are hidden; the page hides them until the viewer turns them on. */
export let spoilersHidden = readPreference('hideSpoilers') !== '0';

export const setSpoilersHidden = (value: boolean): void => {
    spoilersHidden = value;
};

/**
 * Hooks into the last drawn progress view, which sets the ones it has: apply (the list filter changed), open(level),
 * tower(i), area() and find(totals row) frame them on the map, reveal() names a revealed level everywhere, side: the
 * model the sidebar shows, hash() opens the panel the address names (#level=<name>, #tower=<i>, #gate=<i> or #sign=<i>).
 */
export interface Hooks {
    apply: ((redraw?: boolean) => void) | null;
    open: ((level: number) => void) | null;
    tower: ((tower: number) => void) | null;
    area: (() => void) | null;
    find: ((kind: FindKind) => void) | null;
    reveal: (() => void) | null;
    side: ProgressModel | null;
    hash: (() => void) | null;
}

/** The hooks into the last drawn progress view. */
export const hooks: Hooks = {
    apply: null,
    open: null,
    tower: null,
    area: null,
    find: null,
    reveal: null,
    side: null,
    hash: null,
};

/** A redraw drops the hooks into the last drawn progress view. */
export function resetHooks(): void {
    hooks.apply = null;
    hooks.open = null;
    hooks.tower = null;
    hooks.area = null;
    hooks.find = null;
    hooks.reveal = null;
    hooks.side = null;
    hooks.hash = null;
}
