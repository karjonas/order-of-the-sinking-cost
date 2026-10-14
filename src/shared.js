// State shared across modules; the ones other modules change have setters
// a remembered setting in localStorage (or the Storage named by `store`); null when storage is unavailable
export const pref = (k, store = 'localStorage') => {
    try {
        return globalThis[store].getItem(k);
    } catch {
        return null;
    }
};
export const setPref = (k, v, store = 'localStorage') => {
    try {
        globalThis[store].setItem(k, v);
    } catch {}
};
// pickerHelp: the folder picker could not open, so the banner offers the other ways in
export const state = { files: new Map(), camp: null, rendered: null, pickerHelp: false };
export const progressFilters = {};
// the results list follows the map's layer unless this is on
export let listAllLayers = pref('listAllLayers') === '1';
export const setListAllLayers = (v) => {
    listAllLayers = v;
};
export const revealed = {};
export const revealedOf = (camp) => (revealed[camp] ||= new Set());
// goal: the key of the goal the list and the map show, '' for the active one; states: the state chips that narrow the
// list; tower and area: the chips of a tower and an area; find: the totals row (tps, gold, logs) whose missing things the
// map is framed on
export const filtersOf = (camp) =>
    (progressFilters[camp] ||= { q: '', goal: '', states: [], tower: '', area: '', find: '' });
export function clearNarrowing(F) {
    Object.assign(F, { q: '', states: [], tower: '', area: '' });
}
export let spoilersHidden = pref('hideSpoilers') !== '0';
export const setSpoilersHidden = (v) => {
    spoilersHidden = v;
};
// Hooks into the last drawn progress view, which sets the ones it has: apply (the list filter changed), open(level),
// tower(i), area() and find(totals row) frame them on the map, reveal() names a revealed level everywhere, side: the
// model the sidebar shows, hash() opens the panel the address names (#level=<name>, #tower=<i>, #gate=<i> or #sign=<i>)
export const hooks = {
    apply: null,
    open: null,
    tower: null,
    area: null,
    find: null,
    reveal: null,
    side: null,
    hash: null,
};
// a redraw drops the hooks into the last drawn progress view
export function resetHooks() {
    for (const k of Object.keys(hooks)) hooks[k] = null;
}
