// The panel kept open per campaign and the page address that names it (#level=<name>, #tower=<i>, #gate=<i> or
// #sign=<i>) (VIEWER.md "The page (viewer)")
import { hooks } from '../shared.js';

// the open panel per campaign, so a redraw (fog switch, a re-read save) opens it again
export const panelKeep = {};
// the address opens a panel on the first draw of a save only; later draws show the panel kept for the campaign, if any
export let hashDone = false;
export function markHashDone() {
    hashDone = true;
}
export function setHash(hash) {
    try {
        if (location.hash.slice(1) !== hash)
            history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search);
    } catch {}
}
addEventListener('hashchange', () => hooks.hash?.());
