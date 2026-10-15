// Rock and Gem bridges: a Rock or a spare Gem pushed into water sinks and holds the hero up (MOVEMENT.md "Objects in
// water")
import { addTo } from './cells.ts';
import { GEM_KIND } from './beams.ts';
import type { FloodState } from './flood.ts';
import { requeue, visitReached } from './queue.ts';
import type { WalkGrid } from './walker.ts';
import { latestCell } from './walls.ts';

/** One way to push a Rock into water: the hero's push cell and the water cell the Rock sinks in. */
export type BridgeWay = [pushCell: number, waterCell: number];

/** Collects the ways to push each Rock (or Gem) of `unmovedRocks`, still at its level-data cell, into water. */
export function placeBridges(walkGrid: WalkGrid, unmovedRocks: Set<number>): void {
    for (const { pid, pushCell, waterCell } of walkGrid.geometry.bridges) {
        if (!unmovedRocks.has(pid)) continue;
        addTo(walkGrid.bridgesOf, pid, [pushCell, waterCell]);
        walkGrid.bridgeWater.add(waterCell);
    }
}

/**
 * Lets the spare Gems (BeamMoves.spareGems) sink like Rocks: they join the Rocks whose pushes may turn, and the ones
 * still at their level-data cell get their straight bridges. Needs the beam moves laid out.
 */
export function placeGemBridges(walkGrid: WalkGrid): void {
    const { world, geometry, rocks } = walkGrid;
    const { spareGems } = walkGrid.beamMoves;
    const unmovedGems = new Set<number>();

    (world.movables || []).forEach(([pid, column, row, z, kind], index) => {
        if (kind !== GEM_KIND || !spareGems.has(pid)) return;

        const cell = latestCell(walkGrid, pid, column, row, z);
        if (cell < 0) return;

        rocks.push({ pid, cell });
        if (cell === geometry.movableCells[index]) unmovedGems.add(pid);
    });

    placeBridges(walkGrid, unmovedGems);
}

/**
 * Sinks the Rocks whose push cell the walk has reached into their water cell, which then holds the hero; the Rocks
 * go in bridge order, each by its first way whose push cell is reached. Returns whether any Rock sank.
 */
export function sink(walkGrid: WalkGrid, floodState: FloodState): boolean {
    const { triggers, visited } = walkGrid;
    const { bridgeTaken, bridgesDue } = floodState;
    visitReached(floodState, floodState.sinkCursor, (cell) => {
        for (const bridgeIndex of triggers.bridgesAt.get(cell) || []) {
            if (bridgeTaken[bridgeIndex]) continue;
            bridgeTaken[bridgeIndex] = 1;
            bridgesDue.push(bridgeIndex);
        }
    });

    if (!bridgesDue.length) return false;

    bridgesDue.sort((first, second) => first - second);

    for (const bridgeIndex of bridgesDue) {
        const [, ways] = triggers.bridges[bridgeIndex];
        const way = ways.find(([pushCell]) => visited[pushCell]);
        if (!way) throw new Error('a bridge came due without a reached push cell');
        const [, waterCell] = way;
        floodState.bridged.add(waterCell);
        requeue(walkGrid, floodState, waterCell);
    }

    bridgesDue.length = 0;
    return true;
}
