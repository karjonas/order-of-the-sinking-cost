// Which sidebar sections are open: the rows of Find on the map, and the goal whose children are listed (Completionist's
// are the areas). Both may be open together; each scrolls inside its own section
import { readPreference, setPreference } from '../shared.ts';

// the rows of Find on the map; the goal whose children are listed
let findOpen = readPreference('findOpen') !== '0';
let openGoal: string | null = null;

export const findSectionOpen = (): boolean => findOpen;

export const isGoalOpen = (key: string): boolean => openGoal === key;

/** Opens or closes the rows of Find on the map. */
export function setFindSectionOpen(open: boolean): void {
    findOpen = open;
    setPreference('findOpen', open ? '1' : '0');
}

/** Opens the children of a goal, the one open before closes, or closes them with null. */
export function setOpenGoal(key: string | null): void {
    openGoal = key;
}
