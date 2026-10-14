// Ground layers and water: the Ocean_Maps per column and the surface over a cell (WORLD.md "Ground layers", STATE.md
// "Water in the save", MOVEMENT.md "Water")
import { WORLD } from '../data.js';
import { mod, ZB } from './cells.js';
import { place, put } from './groups.js';

// the ground layer of height z
export function layerOf(walkGrid, z) {
    return walkGrid.world.zlayer[Math.min(Math.max(z + walkGrid.zOffset, 0), 255)];
}
// the surface z of the first water map at the column in z's ground layer and at most 2.1 above z (the highest such)
export function waterAt(walkGrid, column, z) {
    const oceanIndices = walkGrid.waterColumns[column];
    if (!oceanIndices) return null;
    const layer = layerOf(walkGrid, z),
        oceans = walkGrid.world.oceans,
        liveOceans = walkGrid.liveOceans;
    for (const oceanIndex of oceanIndices) {
        const ocean = oceans[oceanIndex];
        if (liveOceans[oceanIndex] && ocean[2] === layer && ocean[1] <= z + 2.1) return ocean[1];
    }
    return null;
}
// more than 0.1 under a water surface: a walk can't step there (swimming, or being carried over the sea)
export function deep(walkGrid, cell) {
    const z = Math.floor(cell / walkGrid.layerCells) - ZB,
        surface = waterAt(walkGrid, cell % walkGrid.layerCells, z);
    return surface != null && z < surface - 0.1;
}
// whether `cell` at height z is water level with z (surface within 0.5)
export function levelWater(walkGrid, cell, z) {
    const surface = waterAt(walkGrid, cell % walkGrid.layerCells, z);
    return surface != null && surface >= z - 0.5 && surface < z + 0.5;
}
// water: per column the indices of the Ocean_Maps with water there (level data, then the save's changes), as the game
// keeps them: by map z, highest first (then by index)
export function placeWater(walkGrid) {
    const { world, waterColumns, layerCells, width, height, liveOceans } = walkGrid,
        water = WORLD.water,
        byZ = (x, y) => world.oceans[y][1] - world.oceans[x][1] || x - y;
    for (let column = 0, p = 0; column < layerCells; column++) {
        const n = water[p++];
        if (n) {
            const oceanIndices = (waterColumns[column] = []);
            for (let m = 0; m < n; m++, p += 2) oceanIndices.push(water[p] | (water[p + 1] << 8));
            oceanIndices.sort(byZ);
        }
    }
    const oceanIndexOf = new Map(world.oceans.map((o, n) => [o[0], n]));
    for (const change of walkGrid.latest.ocean) {
        const oceanIndex = oceanIndexOf.get(change.pid);
        if (oceanIndex === undefined || !(change.new & 1)) continue;
        const o = world.oceans[oceanIndex],
            column =
                mod(o[3] + (change.index % o[5]), width) + mod(o[4] + Math.floor(change.index / o[5]), height) * width,
            oceanIndices = (waterColumns[column] ||= []);
        if (!oceanIndices.includes(oceanIndex)) {
            oceanIndices.push(oceanIndex);
            oceanIndices.sort(byZ);
        }
    }
    world.oceans.forEach((o, oceanIndex) =>
        place(walkGrid, o[0], o[7], () => put(walkGrid, liveOceans, oceanIndex, 1)),
    );
}
