// The panel kept open per campaign and the page address that names it (#level=<name>, #tower=<i>, #gate=<i> or
// #sign=<i>) (VIEWER.md "The page (viewer)")
import { hooks } from '../shared.ts';
import type { PanelKey } from '../shared.ts';

/** The open panel per campaign, so a redraw (fog switch, a re-read save) opens it again. */
export const panelKeep: Record<string, PanelKey> = {};

/**
 * The address opens a panel on the first draw of a save only; later draws show the panel kept for the campaign, if any.
 */
export let hashDone = false;

/** Records that the address has been read, so later draws keep the panel kept for the campaign. */
export function markHashDone(): void {
    hashDone = true;
}

/** Puts the hash in the address without adding a history entry; an empty hash clears it. */
export function setHash(hash: string): void {
    try {
        if (location.hash.slice(1) !== hash) {
            history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search);
        }
    } catch {}
}

addEventListener('hashchange', () => hooks.hash?.());
