// Magic-mirror hops (MOVEMENT.md "Magic mirrors", VIEWER.md "Magic-mirror hops")
import { roomOf } from './beams.ts';
import { addTo, cellOnSide, BEAMSTOP, GATE, MONSTER, MOVABLE, ROCK, SOLID, STEP, Z_BIAS } from './cells.ts';
import type { Latch } from './gates.ts';
import { exists } from './groups.ts';
import { deep } from './ocean.ts';
import type { WalkGrid } from './walker.ts';
import { fenced, latestCell } from './walls.ts';

/**
 * A magic-mirror hop off a Switch not pressed, laid with the hero pressing it: the rays see the flavor's gates as a
 * press leaves them. The hero lands with the Switch released.
 */
export interface SwitchHop {
    flavor: number;
    switchCell: number;
    landing: number;
}

/**
 * The magic-mirror hops: per arm cell, the landing cells; the arm cells of a Mirror riding a lily; and the hops off a
 * Switch on an arm that the hero holds down.
 */
export interface MirrorHops {
    hops: Map<number, number[]>;
    driftHops: Set<number>;
    switchHops: SwitchHop[];
}

/** A flat or vertical magic Mirror and the sides its two open arms point to (-1 for none). */
export interface MagicMirror {
    mirrorCell: number;
    vertical: number;
    arms: [first: number, second: number];
}

/** How far along a Mirror's arm the first target, the first stop and the first Fence are (Infinity: none). */
interface ArmScan {
    target: number;
    stop: number;
    fence: number;
}

/** Whether the Gate in `cell` is shut: as the save left it, or with `pressed` as a press of its flavor leaves it. */
function gateShut(walkGrid: WalkGrid, cell: number, pressed: Latch | null): boolean {
    const isGate = (walkGrid.grid[cell] & GATE) !== 0;
    if (!pressed) return isGate;
    if (pressed.shut.includes(cell)) return true;
    return isGate && !pressed.open.includes(cell);
}

/**
 * Whether a ray along an arm ends at `cell`: a solid voxel, a shut Gate (with `pressed`, as a press of that flavor
 * leaves the Gates), a frozen cell, or what stops a beam.
 */
function stopsRay(walkGrid: WalkGrid, cell: number, pressed: Latch | null): boolean {
    const bits = walkGrid.grid[cell];
    if (bits & SOLID || walkGrid.frozen.has(cell)) return true;
    if (gateShut(walkGrid, cell, pressed)) return true;
    return (bits & (ROCK | MOVABLE)) !== 0 && (bits & BEAMSTOP) !== 0;
}

/** Whether `cell` holds a mirror target: a Monster, a MIRRORABLE Rock or a mirrorable movable. */
function isTarget(walkGrid: WalkGrid, cell: number): boolean {
    const bits = walkGrid.grid[cell];
    if (bits & MONSTER) return true;
    return (bits & (ROCK | MOVABLE)) !== 0 && (bits & BEAMSTOP) === 0;
}

/** The side of a grid step, -1 when it is none of the four. */
function sideOf(dx: number, dy: number): number {
    return STEP.findIndex(([stepX, stepY]) => stepX === dx && stepY === dy);
}

/** The cell `distance` cells from `mirrorCell` along side `side`. */
function cellAlong(walkGrid: WalkGrid, mirrorCell: number, side: number, distance: number): number {
    let cell = mirrorCell;
    for (let step = 0; step < distance; step++) cell = cellOnSide(walkGrid, cell, side);
    return cell;
}

/**
 * Scans the arm of `mirrorCell` on side `side` for its first target, its first stop and its first Fence, with the
 * Gates as the save left them or as the press `pressed` leaves them. The cell a pushed Mirror left (`vacated`) ends
 * nothing.
 */
function scanArm(
    walkGrid: WalkGrid,
    mirrorCell: number,
    side: number,
    rayLength: number,
    pressed: Latch | null,
    vacated: number,
): ArmScan {
    const found: ArmScan = { target: Infinity, stop: Infinity, fence: Infinity };
    let previous = mirrorCell;
    let cell = cellOnSide(walkGrid, mirrorCell, side);

    for (let distance = 1; distance <= rayLength; distance++) {
        if (found.fence === Infinity && fenced(walkGrid, previous, side, cell)) found.fence = distance;

        if (cell !== vacated && stopsRay(walkGrid, cell, pressed)) {
            found.stop = distance;
            break;
        }

        if (cell !== vacated && isTarget(walkGrid, cell)) {
            found.target = distance;
            break;
        }

        previous = cell;
        cell = cellOnSide(walkGrid, cell, side);
    }

    return found;
}

/**
 * Calls visit(armCell, landing) for each cell of the arm on `heroSide` that a hero hops from, landing as far down the
 * arm on `landSide`: he stands nearer than the other arm's first stop or target, with no Fence on either path. The
 * Gates are as the save left them, or as the press `pressed` leaves them. The cell a pushed Mirror left (`vacated`)
 * ends no ray.
 */
export function armHops(
    walkGrid: WalkGrid,
    mirrorCell: number,
    heroSide: number,
    landSide: number,
    pressed: Latch | null,
    vacated: number,
    visit: (armCell: number, landing: number) => void,
): void {
    const rayLength = Math.max(100, walkGrid.width, walkGrid.height);
    const otherArm = scanArm(walkGrid, mirrorCell, landSide, rayLength, pressed, vacated);
    let previous = mirrorCell;
    let cell = cellOnSide(walkGrid, mirrorCell, heroSide);

    for (let distance = 1; distance <= rayLength && distance < otherArm.target; distance++) {
        if (fenced(walkGrid, previous, heroSide, cell)) break;
        if (cell !== vacated && (stopsRay(walkGrid, cell, pressed) || isTarget(walkGrid, cell))) break;
        if (distance >= otherArm.stop || distance >= otherArm.fence) break;

        visit(cell, cellAlong(walkGrid, mirrorCell, landSide, distance));
        previous = cell;
        cell = cellOnSide(walkGrid, cell, heroSide);
    }
}

/** Per cell of an existing Switch not pressed, not under water, whose flavor has gates a press changes: its flavors. */
function heldSwitches(walkGrid: WalkGrid): Map<number, number[]> {
    const flavorsAt = new Map<number, number[]>();

    for (const [flavor, switchCells] of walkGrid.unpressed) {
        if (!walkGrid.latch.has(flavor)) continue;
        for (const switchCell of new Set(switchCells)) {
            if (switchCell >= 0 && !deep(walkGrid, switchCell)) addTo(flavorsAt, switchCell, flavor);
        }
    }

    return flavorsAt;
}

/** The listed magic Mirrors that exist, at their latest cells, not in the cell of a closed Freezer. */
export function magicMirrorsOf(walkGrid: WalkGrid): MagicMirror[] {
    const { closedFreezers } = walkGrid;
    const freezerIndexOf = walkGrid.geometry.freezerIndexOf;
    const mirrors: MagicMirror[] = [];

    for (const mirror of walkGrid.world.magic_mirrors || []) {
        const [pid, i, j, z, firstArmX, firstArmY, secondArmX, secondArmY, vertical, freezer, existence] = mirror;
        const mirrorCell = latestCell(walkGrid, pid, i, j, z);
        if (mirrorCell < 0 || !exists(walkGrid, pid, existence)) continue;

        const freezerIndex = freezerIndexOf.get(freezer);
        if (freezer && freezerIndex !== undefined && closedFreezers[freezerIndex]) continue;

        const arms: [number, number] = [sideOf(firstArmX, firstArmY), sideOf(secondArmX, secondArmY)];
        mirrors.push({ mirrorCell, vertical, arms });
    }

    return mirrors;
}

/** Per room, how many of `mirrors` stand in it. */
export function mirrorsPerRoom(walkGrid: WalkGrid, mirrors: MagicMirror[]): Map<string, number> {
    const perRoom = new Map<string, number>();

    for (const { mirrorCell } of mirrors) {
        const room = roomOf(walkGrid, mirrorCell);
        perRoom.set(room, (perRoom.get(room) ?? 0) + 1);
    }

    return perRoom;
}

/**
 * The magic-mirror hops. ACTIVATE swaps every target of a room's magic Mirrors with its mirage, all or none; a hero
 * on one open arm of a flat magic Mirror lands on the cell as far down the other arm. Modelled for a magic Mirror
 * alone in its room (19 x 13 cells per layer), not in a closed Freezer and below the map rooms. A ray along an arm
 * ends at a solid voxel, a shut Gate, a frozen cell or a Rock or movable a beam does not pass, and at a target (a
 * Monster, a MIRRORABLE Rock, a mirrorable movable); the hero must stand nearer than the other arm's first stop or
 * target, with no Fence on either path. The hops of a Mirror riding a lily hold only while the lily stays where the
 * save last left it. A hero on a Switch not pressed holds it down, so the hops off it are laid again with the Gates as
 * a press of its flavor leaves them (`switchHops`); those landings that differ are kept for the flood to check.
 */
export function magicMirrorHops(walkGrid: WalkGrid): MirrorHops {
    const { width, height, layerCells, boxZ, lilyCells } = walkGrid;
    const hopsByCell = new Map<number, number[]>();
    const drifting = new Set<number>();
    const switchHops: SwitchHop[] = [];
    const rayLength = Math.max(100, width, height);
    const switchFlavorsAt = heldSwitches(walkGrid);

    // the hops of a hero on the arm on `heroSide`, landing along the arm on `landSide`
    const addHops = (mirrorCell: number, heroSide: number, landSide: number, onLily: boolean): void => {
        armHops(walkGrid, mirrorCell, heroSide, landSide, null, -1, (armCell, landing) => {
            addTo(hopsByCell, armCell, landing);
            if (onLily) drifting.add(armCell);
        });

        const switchCells = new Set<number>();
        let cell = mirrorCell;

        for (let distance = 1; distance <= rayLength; distance++) {
            cell = cellOnSide(walkGrid, cell, heroSide);
            if (switchFlavorsAt.has(cell)) switchCells.add(cell);
        }

        for (const switchCell of switchCells) {
            const plainLandings = hopsByCell.get(switchCell) ?? [];

            for (const flavor of switchFlavorsAt.get(switchCell) ?? []) {
                const pressed = walkGrid.latch.get(flavor) ?? null;

                armHops(walkGrid, mirrorCell, heroSide, landSide, pressed, -1, (armCell, landing) => {
                    if (armCell !== switchCell || plainLandings.includes(landing)) return;

                    switchHops.push({ flavor, switchCell, landing });
                    if (onLily) drifting.add(armCell);
                });
            }
        }
    };

    const mirrors = magicMirrorsOf(walkGrid);
    const perRoom = mirrorsPerRoom(walkGrid, mirrors);

    for (const { mirrorCell, vertical, arms } of mirrors) {
        const sharesRoom = (perRoom.get(roomOf(walkGrid, mirrorCell)) ?? 0) > 1;
        if (vertical || sharesRoom) continue;

        const [firstArm, secondArm] = arms;
        const mirrorZ = Math.floor(mirrorCell / layerCells) - Z_BIAS;
        if (mirrorZ >= boxZ || firstArm < 0 || secondArm < 0) continue;

        const onLily = lilyCells.has(mirrorCell);

        addHops(mirrorCell, firstArm, secondArm, onLily);
        addHops(mirrorCell, secondArm, firstArm, onLily);
    }

    return { hops: hopsByCell, driftHops: drifting, switchHops };
}
