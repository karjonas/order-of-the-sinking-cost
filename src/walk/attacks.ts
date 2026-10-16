// Dragon fire and goblin attacks (MOVEMENT.md "Goblins, dragons and PROTECTION", VIEWER.md "Attacks")
import { latestF32 } from '../save.ts';
import { addTo, cellOnSide, FIRE, FIRE_STOP, GOBLIN_STOP, mod, MONSTER } from './cells.ts';
import { exists, place, put } from './groups.ts';
import { doorIn, doorOut } from './skills.ts';
import type { WalkGrid } from './walker.ts';
import { latestCell, noteTarget } from './walls.ts';

// world.monsters kinds below the dragons' facing sides
export const GOBLIN = -1;

/** Marks `cell` attacked, and counts the attack. */
function attack(walkGrid: WalkGrid, cell: number): void {
    walkGrid.attacked.add(cell);
    walkGrid.cellFlags[cell] |= FIRE;
    walkGrid.attackCount.set(cell, (walkGrid.attackCount.get(cell) ?? 0) + 1);
}

/**
 * Whether a goblin or a dragon's fire attacks `cell`. A hero who steps into it dies in that turn's attack unless he is
 * protected, so a push that moves him into the cell the object leaves is no push for a hero without PROTECTION.
 */
export function attackedAt(walkGrid: WalkGrid, cell: number): boolean {
    return (walkGrid.cellFlags[cell] & FIRE) !== 0;
}

/** A goblin's facing: GOBLIN; a dragon's: its facing side, from its latest theta_target, else the level data's. */
function foeFacing(walkGrid: WalkGrid, pid: number, kind: number): number {
    if (kind < 0) return GOBLIN;
    const theta = latestF32(walkGrid.latest, pid, 'base.theta_target');
    if (theta !== undefined) return mod(Math.round(theta / 90), 4);
    return kind;
}

/** A goblin attacks the 6 cells next to it, above and below included, unless a GOBLIN_STOP stands there. */
function goblinAttacks(walkGrid: WalkGrid, goblinCell: number): void {
    const { grid, layerCells } = walkGrid;
    const targets: number[] = [];

    for (let side = 0; side < 4; side++) {
        targets.push(cellOnSide(walkGrid, goblinCell, side));
    }

    targets.push(goblinCell + layerCells, goblinCell - layerCells);

    for (const target of targets) {
        const insideGrid = target >= 0 && target < grid.length;
        if (insideGrid && !(grid[target] & GOBLIN_STOP)) attack(walkGrid, target);
    }
}

/**
 * A dragon's fire runs from its cell along its facing until a FIRE_STOP, a closed Freezer or a Wardrobe door. Returns
 * the cells it runs through.
 */
function dragonFire(walkGrid: WalkGrid, dragonCell: number, side: number): number[] {
    const { grid, frozen, width, height } = walkGrid;
    const cells: number[] = [];
    let cell = dragonCell;

    for (let stepsLeft = width + height; stepsLeft > 0; stepsLeft--) {
        const next = cellOnSide(walkGrid, cell, side);
        if (next === dragonCell) break;
        if (doorOut(walkGrid, cell, side) >= 0 || doorIn(walkGrid, next, side) >= 0) break;
        if (grid[next] & FIRE_STOP || frozen.has(next)) break;
        attack(walkGrid, next);
        walkGrid.burning.add(next);
        cells.push(next);
        cell = next;
    }

    return cells;
}

/**
 * Places the living Monsters and the cells they attack, which kill a hero without PROTECTION and hold one with it
 * over water or air: a dragon's fire and the cells around a goblin. Every Monster is in the grid before any attack
 * runs, since a Monster stops fire.
 */
export function placeAttacks(walkGrid: WalkGrid): void {
    const { world, grid, latest } = walkGrid;
    const foes: Array<[cell: number, facing: number, monsterIndex: number]> = [];

    for (const [pid, i, j, z, kind, existence] of world.monsters || []) {
        const cell = latestCell(walkGrid, pid, i, j, z);
        if (cell < 0 || latestF32(latest, pid, 'dead_t', 0) > 0) continue;

        // a Monster that a Group makes exist blocks its cell; its attacks are left out
        if (!exists(walkGrid, pid, existence)) {
            place(walkGrid, pid, existence, () => put(walkGrid, grid, cell, MONSTER));
            continue;
        }

        grid[cell] |= MONSTER;
        noteTarget(walkGrid, cell);

        let facing = kind;
        if (kind >= GOBLIN) facing = foeFacing(walkGrid, pid, kind);

        const monsterIndex = walkGrid.monsters.length;
        walkGrid.monsters.push({ pid, cell, facing });
        if (kind >= GOBLIN) foes.push([cell, facing, monsterIndex]);
    }

    castAttacks(walkGrid, foes);
}

/** Runs the attacks of the goblins and dragons `foes` (their cell, facing and index into `monsters`). */
function castAttacks(walkGrid: WalkGrid, foes: Array<[cell: number, facing: number, monsterIndex: number]>): void {
    for (const [foeCell, facing, monsterIndex] of foes) {
        if (facing === GOBLIN) {
            goblinAttacks(walkGrid, foeCell);
            continue;
        }

        const fireCells = dragonFire(walkGrid, foeCell, facing);
        walkGrid.fireOf.set(monsterIndex, fireCells);
        for (const fireCell of fireCells) addTo(walkGrid.burningBy, fireCell, monsterIndex);
    }
}

/**
 * Works out the attacks of the living goblins and dragons again, for the Freezers and objects as the grid has them now:
 * a dragon's fire runs through a Freezer that is open and stops at one that is closed.
 */
export function recastAttacks(walkGrid: WalkGrid): void {
    for (const cell of walkGrid.attacked) walkGrid.cellFlags[cell] &= ~FIRE;

    walkGrid.attacked.clear();
    walkGrid.burning.clear();
    walkGrid.burningBy.clear();
    walkGrid.fireOf.clear();
    walkGrid.attackCount.clear();

    const foes: Array<[cell: number, facing: number, monsterIndex: number]> = [];

    walkGrid.monsters.forEach(({ cell, facing }, monsterIndex) => {
        if (facing >= GOBLIN) foes.push([cell, facing, monsterIndex]);
    });

    castAttacks(walkGrid, foes);
}
