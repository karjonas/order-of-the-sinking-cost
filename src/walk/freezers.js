// The ice gates: those that hold level entrances, and the closed ones in a walker's grid (STATE.md "Ice gates in the
// save")
import { PROG } from '../data.js';
import { cellOf } from './cells.js';

// per level, the ice gate whose cell holds its entrance (the level is frozen in it until the gate opens), else undefined
export const ICE = (() => {
    const key = (p) => p.map(Math.round).join(),
        at = new Map((PROG.freezers || []).map((fz, fi) => [key(fz.p), fi]));
    return (PROG.levels || []).map((l) => at.get(key(l.p)));
})();
export function freezeGates(walkGrid) {
    PROG.freezers.forEach((fz, fi) => {
        const cell = cellOf(walkGrid, ...fz.p);
        if (walkGrid.closedFreezers[fi] && cell >= 0) walkGrid.frozen.set(cell, fi);
    });
}
