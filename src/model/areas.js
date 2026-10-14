// The areas: which Area_Pins are activated and the area a point or a level is in
// (STATE.md "Areas", VIEWER.md "Level areas (viewer)")
import { PROG } from '../data.js';
import { latestFlag, latestOf } from '../save.js';

// Area_Pins the hero has activated: the newest `activated` per pin in the history, plus the ones a new game starts with
export function activePins(history) {
    const on = new Set(history?.pinsOn || []),
        lt = history ? latestOf(history) : null;
    for (const a of PROG.areas || []) {
        if (latestFlag(lt, a.pin, 'activated', on.has(a.pin))) on.add(a.pin);
        else on.delete(a.pin);
    }
    return on;
}
// the area the hero stands in: of the local_area boxes containing the point, those whose pin is activated, the lowest
// float_parameter first; a box wraps with the world in x and y (`w`) and is rotated by its quaternion
export function heroAreaAt(position, pinsOn) {
    if (!position) return null;
    let best = null;
    (PROG.areas || []).forEach((a, areaIndex) => {
        if (!pinsOn.has(a.pin)) return;
        for (const box of a.boxes || []) {
            if (best && box.f >= best.f) continue;
            const offset = position.map((v, i) => v - box.p[i]);
            for (let i = 0; i < 2; i++)
                if (box.w[i]) {
                    if (offset[i] > box.w[i] / 2) offset[i] -= box.w[i];
                    else if (offset[i] < -box.w[i] / 2) offset[i] += box.w[i];
                }
            const [qx, qy, qz, qw] = [-box.q[0], -box.q[1], -box.q[2], box.q[3]],
                [vx, vy, vz] = offset;
            const tx = 2 * (qy * vz - qz * vy),
                ty = 2 * (qz * vx - qx * vz),
                tz = 2 * (qx * vy - qy * vx);
            const l = [
                vx + qw * tx + (qy * tz - qz * ty),
                vy + qw * ty + (qz * tx - qx * tz),
                vz + qw * tz + (qx * ty - qy * tx),
            ];
            if (l.every((v, i) => Math.abs(box.s[i] ? v / box.s[i] : v) - box.e[i] <= 0))
                best = { ai: areaIndex, f: box.f };
        }
    });
    return best ? best.ai : null;
}
// The area a level's entry is named by: in boxes of several areas (`overlap`: [area index, float_parameter] in record
// order) the lowest float_parameter among the activated pins' boxes, the first on a tie; with none of them activated,
// or outside overlaps, its area from the level data (all pins activated)
export function levelAreaOf(level, pinsOn) {
    if (!level.overlap) return level.area ?? null;
    let best = null;
    for (const [area, priority] of level.overlap) {
        if (!pinsOn.has(PROG.areas[area].pin)) continue;
        if (best === null || priority < best.priority) best = { area, priority };
    }
    if (best === null) return level.area ?? null;
    return best.area;
}
