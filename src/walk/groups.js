// Existence Groups: whether an entity exists, and the cell writes of the members of a Group that does not (VIEWER.md
// "Existence")
import { rawU32 } from '../save.js';

const EXISTS = 1 << 26,
    IN_GROUP = 1 << 25,
    // EXISTS_FOR_COSMETIC_TRANSITION_PURPOSES_ONLY, NOT_SNAPPED_TO_GRID, PLAYABLE_IN_PRELUDE
    SKIPPED = (1 << 29) | (1 << 9) | (1 << 24);

// The game's cell lookup skips an entity whose latest CREATION_OR_DESTRUCTION record destroyed it, and by its latest
// entity_flags (else the level-data `ex`; undefined: never skipped) one IN_EXISTENCE_GROUP without CURRENTLY_EXISTS,
// one EXISTS_FOR_COSMETIC_TRANSITION_PURPOSES_ONLY, a NOT_SNAPPED_TO_GRID one (no Door is in these lists) and a
// PLAYABLE_IN_PRELUDE one (the overworld has no prelude). A Group whose latest `exists` differs from its
// exists_by_default takes its direct members with it.
export function exists(walkGrid, pid, existence) {
    const lt = walkGrid.latest;
    if (lt.created.get(pid)?.destroyed) return false;
    const flags = lt.get(pid, 'base.entity_flags'),
        groupIndex = walkGrid.groupOfMember.get(pid);
    if (flags && rawU32(flags) & SKIPPED) return false;
    const groupExists = walkGrid.groupExists;
    if (groupIndex !== undefined && groupExists[groupIndex] !== !!walkGrid.existenceGroups[groupIndex][1])
        return groupExists[groupIndex];
    if (!flags) return existence === undefined || !!existence;
    const value = rawU32(flags);
    return !(value & IN_GROUP) || (value & EXISTS) !== 0;
}
// sets `bits` in array[index]; while withGroups runs the dormant writes, the old value goes to its write log
export function put(walkGrid, array, index, bits) {
    if (walkGrid.writeLog) walkGrid.writeLog.push(array, index, array[index]);
    array[index] |= bits;
}
// runs write() now when the entity exists, else keeps it for its Group when only the Group keeps it from existing
export function place(walkGrid, pid, ex, write) {
    if (exists(walkGrid, pid, ex)) return write();
    const groupIndex = walkGrid.groupOfMember.get(pid);
    if (groupIndex === undefined || walkGrid.groupExists[groupIndex] || walkGrid.latest.created.get(pid)?.destroyed)
        return;
    const flags = walkGrid.latest.get(pid, 'base.entity_flags');
    if (!flags || !(rawU32(flags) & SKIPPED)) walkGrid.dormantWrites[groupIndex].push(write);
}
// the Group that keeps an entity from existing while it does not exist itself, else undefined
export function dormantGroup(walkGrid, pid, ex) {
    if (exists(walkGrid, pid, ex)) return undefined;
    const groupIndex = walkGrid.groupOfMember.get(pid);
    if (groupIndex === undefined || walkGrid.groupExists[groupIndex] || walkGrid.latest.created.get(pid)?.destroyed)
        return undefined;
    const flags = walkGrid.latest.get(pid, 'base.entity_flags');
    if (flags && rawU32(flags) & SKIPPED) return undefined;
    return groupIndex;
}
// whether an entity exists, counting the Groups withGroups is making exist
export function existsNow(walkGrid, pid, ex) {
    if (exists(walkGrid, pid, ex)) return true;
    if (!walkGrid.groupsMade) return false;
    return walkGrid.groupsMade.has(dormantGroup(walkGrid, pid, ex));
}
// runs callback(changed) with the existence Groups `groupIndices` made to exist the way the game does it: each existence
// subgroup too (21 deep at most), except one that an existing Group unexists (unexist_this_id(2, 3)); a Group that
// exists already ends the recursion. The members' cell writes are undone afterwards. A THROUGH light the Groups power
// (the light, a Gem_Slot or a Gem of its room is a member) casts its beam after the cell writes; other beams, fire,
// pads, Wardrobes, elevators and switch latches stay as they were. changed: whether any cell changed.
export function withGroups(walkGrid, groupIndices, callback) {
    const { groupExists, existenceGroups, dormantWrites, dormantLights } = walkGrid;
    const made = new Set(),
        isOn = (groupIndex) => groupExists[groupIndex] || made.has(groupIndex),
        make = (groupIndex, depth) => {
            if (depth >= 21 || isOn(groupIndex)) return;
            made.add(groupIndex);
            for (const subgroup of existenceGroups[groupIndex][2])
                if (!existenceGroups[subgroup][3].some(isOn)) make(subgroup, depth + 1);
        };
    for (const groupIndex of groupIndices) if (groupIndex !== undefined) make(groupIndex, 0);
    if (![...made].some((groupIndex) => dormantWrites[groupIndex].length || dormantLights[groupIndex].length))
        return callback(false);
    walkGrid.writeLog = [];
    for (const groupIndex of made) for (const write of dormantWrites[groupIndex]) write();
    const lights = new Set();
    for (const groupIndex of made) for (const light of dormantLights[groupIndex]) lights.add(light);
    walkGrid.groupsMade = made;
    for (const light of lights) light();
    walkGrid.groupsMade = null;
    const undo = walkGrid.writeLog;
    walkGrid.writeLog = null;
    try {
        return callback(true);
    } finally {
        for (let n = undo.length - 3; n >= 0; n -= 3) undo[n][undo[n + 1]] = undo[n + 2];
    }
}
