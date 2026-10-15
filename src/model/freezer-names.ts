// What the page calls a Freezer, by its model: the pod (model A) is an ice cage, the doorway (model B, `doorway`) an
// ice gate (VIEWER.md "The page (viewer)")
import { PROG } from '../data.ts';

/** Whether the Freezer is the doorway model. */
export const isDoorway = (freezer: number): boolean => !!PROG.freezers[freezer].doorway;

/** "ice cage" or "ice gate". */
export function freezerNoun(freezer: number): string {
    if (isDoorway(freezer)) return 'ice gate';
    return 'ice cage';
}

/** The plural of one model: "ice gates" for the doorways, else "ice cages". */
export function modelNoun(doorway: boolean): string {
    if (doorway) return 'ice gates';
    return 'ice cages';
}

/** "ice cages", "ice gates", or "ice cages and gates" when the Freezers are of both models; "ice cages" for none. */
export function freezersNoun(indices: number[]): string {
    const doorways = indices.filter(isDoorway).length;
    if (doorways === 0) return modelNoun(false);
    if (doorways === indices.length) return modelNoun(true);
    return 'ice cages and gates';
}

/** A noun with a capital first letter, for labels: "Ice cage". */
export const capitalized = (noun: string): string => noun[0].toUpperCase() + noun.slice(1);
