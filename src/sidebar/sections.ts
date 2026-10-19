// Which sidebar sections are open. The goals' children and Find on the map may be open together; the area list takes the
// sidebar's height from both, so opening it folds them and opening either folds it, and one list at most scrolls
import { readPreference, setPreference } from '../shared.ts';

// whether the area list is open; the rows of Find on the map; the goal whose children are listed
let areasOpen = readPreference('areasOpen') === '1';
let findOpen = readPreference('findOpen') !== '0';
let openGoal: string | null = null;

export const areaListOpen = (): boolean => areasOpen;

export const findSectionOpen = (): boolean => findOpen;

export const isGoalOpen = (key: string): boolean => openGoal === key;

/** Opens or closes the area list; opening it folds the goal's children and Find on the map. */
export function setAreaListOpen(open: boolean): void {
    areasOpen = open;
    setPreference('areasOpen', open ? '1' : '0');
    if (!open) return;

    openGoal = null;
    setFindSectionOpen(false);
}

/** Opens or closes the rows of Find on the map; opening them folds the area list. */
export function setFindSectionOpen(open: boolean): void {
    findOpen = open;
    setPreference('findOpen', open ? '1' : '0');
    if (open && areasOpen) setAreaListOpen(false);
}

/** Opens the children of a goal, the one open before closes, or closes them with null; opening folds the area list. */
export function setOpenGoal(key: string | null): void {
    openGoal = key;
    if (key !== null && areasOpen) setAreaListOpen(false);
}
