// Rock bridges: a Rock pushed into water sinks and holds the hero up (MOVEMENT.md "Rocks in water")
import { addTo, keyOf } from './cells.js';
import { requeue, visitReached } from './queue.js';

export function placeBridges(walkGrid, unmovedRocks) {
    for (const [pid, pi, pj, pz, bi, bj, bz] of walkGrid.world.bridges || []) {
        if (!unmovedRocks.has(pid)) continue;
        const waterCell = keyOf(walkGrid, bi, bj, bz);
        addTo(walkGrid.bridgesOf, pid, [keyOf(walkGrid, pi, pj, pz), waterCell]);
        walkGrid.bridgeWater.add(waterCell);
    }
}
// a Rock whose push cell the walk has reached is pushed into its water cell, which then holds the hero; the Rocks go in
// bridge order, each by its first way whose push cell is reached
export function sink(walkGrid, floodState) {
    const { triggers, visited } = walkGrid,
        { bridgeTaken, bridgesDue } = floodState;
    visitReached(floodState, floodState.sinkCursor, (k) => {
        for (const n of triggers.bridgesAt.get(k) || []) {
            if (bridgeTaken[n]) continue;
            bridgeTaken[n] = 1;
            bridgesDue.push(n);
        }
    });
    if (!bridgesDue.length) return false;
    bridgesDue.sort((a, b) => a - b);
    for (const n of bridgesDue) {
        const way = triggers.bridges[n][1].find(([pc]) => visited[pc]);
        floodState.bridged.add(way[1]);
        requeue(walkGrid, floodState, way[1]);
    }
    bridgesDue.length = 0;
    return true;
}
