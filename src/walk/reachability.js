// Where the hero has been and can go: the reached cells, the levels behind closed ice gates and the floor heights
// (VIEWER.md "Seeds and the reached cells", "Pockets, leads and why")
import { PROG, WORLD } from '../data.js';
import { heroesWithSkill, latestFlag, PROTECTION_FLAG, TELEPORT_FLAG } from '../save.js';
import { addTo, gridCol, ZB } from './cells.js';
import { ICE } from './freezers.js';
import { walker } from './walker.js';

// latestOf() of a history with no changes: the level data
export const NO_HISTORY = { get: () => undefined, ocean: [], created: new Map() };
// Flood fill over walkable cells from everywhere the save shows the hero has been: every hero position the history
// keeps (vertical Beamcaster beams, mirrors and dragon swaps take the hero where the walk can't follow), entered levels,
// activated Area_Pins and discovered teleporters. `dead` counts the kept hero positions (the current one among them)
// inside a wall no beam runs through; they seed nothing.
export function reachability(history, latest, teleporterStates, closed, entered) {
    const levels = PROG.levels,
        teleporters = PROG.teleporters,
        { flood, skyEntrances, land, padCell, deep, shown, mechAt, heroSeed, insideWall, fire, cellOf, frozen } =
            walker(latest, teleporterStates, closed);
    const levelCells = levels.map((l) => cellOf(...l.p)),
        seeds = [history.hero ? heroSeed(history.hero) : -1],
        guy = PROG.world.guy || [0, 0],
        protectionKeys = heroesWithSkill(history, guy, PROTECTION_FLAG),
        wizards = heroesWithSkill(history, guy, TELEPORT_FLAG);
    let deadSeeds = 0;
    // a kept position seeds the PROTECTION layer when the hero wore it there; such a hero inside an attacked cell was
    // held in it, over water or air too. One where the hero held TELEPORT seeds the TELEPORT layer as well.
    for (const position of history.heroes?.values() || []) {
        const cell = cellOf(...position),
            key = position.join(','),
            wearsProtection = protectionKeys.has(key),
            seedCell = wearsProtection && fire.has(cell) ? cell : land(cell, false);
        if (insideWall(cell)) deadSeeds++;
        else if (seedCell >= 0 && !deep(seedCell)) {
            seeds.push(wearsProtection ? [seedCell, 1] : seedCell);
            if (!wearsProtection && wizards.has(key)) seeds.push([seedCell, 2]);
        }
    }
    levels.forEach((l, i) => {
        if (entered[i]) seeds.push(land(levelCells[i]));
    });
    for (const [pid, x, y, z] of PROG.world.area_pins)
        if (latestFlag(latest, pid, 'activated')) seeds.push(land(cellOf(x, y, z), false));
    teleporters.forEach((t, i) => {
        if (teleporterStates[i].disc) seeds.push(padCell(i));
    });
    const front = new Set(),
        reached = flood(seeds, null, front),
        inReached = (S, k) => S.has(k) || S.has(land(k));
    // a level whose entrance is the cell of a closed ice gate is entered once that gate opens, whatever lies next to it
    const frozenIn = ICE.map((fi) => (fi !== undefined && closed[fi] ? fi : undefined)),
        level = levels.map((l, i) => frozenIn[i] === undefined && inReached(reached, levelCells[i]));
    // levels not entered and not reached, with the cells they stand in; restAt: per cell, the positions in `rest` of the
    // levels there
    // a level frozen in a closed ice gate starts its walk in the gate's own cell, where the hero stands once it opens
    const rest = levels.map((l, i) => i).filter((i) => !entered[i] && !level[i]),
        restCells = rest.map((i) => (frozenIn[i] === undefined ? land(levelCells[i]) : levelCells[i])),
        restAt = new Map();
    rest.forEach((i, n) => {
        for (const k of new Set([levelCells[i], restCells[n]])) if (k >= 0) addTo(restAt, k, n);
    });
    // the positions of `hits` that a set of cells holds, from the smaller side: per cell of `at` (cell -> positions)
    const hitsIn = (S, at, len) => {
        const hit = new Uint8Array(len);
        if (S.size < at.size) {
            for (const k of S) for (const n of at.get(k) || []) hit[n] = 1;
        } else for (const [k, ns] of at) if (S.has(k)) for (const n of ns) hit[n] = 1;
        return hit;
    };
    const inSet = (S) => {
        const hit = hitsIn(S, restAt, rest.length);
        return rest.filter((i, n) => hit[n]);
    };
    // leads: for each closed gate on the edge of the reached cells, the levels not entered yet that opening it alone
    // would reach; a gate that leads only into pockets of cells not bordering the reached ones keeps its levels in
    // `pocket`. byGate holds both, the gates on the edge first.
    const byGate = new Map(),
        bucket = (fi) => {
            let a = byGate.get(fi);
            if (!a) byGate.set(fi, (a = new Set()));
            return a;
        },
        mech = new Uint8Array(levels.length);
    for (const fi of front) {
        const gateCell = cellOf(...PROG.freezers[fi].p);
        frozen.delete(gateCell);
        const cells = flood([land(gateCell)], reached);
        frozen.set(gateCell, fi);
        byGate.set(fi, new Set(inSet(cells).filter((i) => frozenIn[i] === undefined || frozenIn[i] === fi)));
    }
    // a level not reached sits behind the closed gates on the edge of its own pocket of walkable cells, and may need
    // the unmodelled mechanics in or next to the pocket; first: the levels of the first pocket each level is in
    const done = new Uint8Array(levels.length),
        first = new Map();
    // fromSky: per level, 1 when a hero stepping off a sky ledge falls into its pocket (through a hole in a sky floor
    // over it, or off a sky floor's edge)
    const fromSky = new Uint8Array(levels.length),
        enteredFromSky = skyEntrances();
    // a pocket holding a pad that another pad reveals is also entered by reaching that pad, so the closed gates on the
    // edge of the revealing pad's own pocket lead into it too, and so does reaching a level in that pocket (viaPads: per
    // level, those gates not on its own pocket's edge, and those levels); revealedAt: per revealed pad cell, the
    // positions in `revealers`
    const revealers = teleporters
            .map((t, ti) => [padCell(ti), shown[ti].map(padCell)])
            .filter(([c, to]) => c >= 0 && to.length && !reached.has(c)),
        revealedAt = new Map(),
        padPocket = new Map(),
        pocketOf = (c) => {
            if (!padPocket.has(c)) {
                const bumped = new Set(),
                    cells = flood([c], reached, bumped, { reveal: false });
                padPocket.set(c, { bumped, levels: inSet(cells).filter((j) => frozenIn[j] === undefined) });
            }
            return padPocket.get(c);
        },
        viaPads = new Map();
    revealers.forEach(([, to], r) => {
        for (const t of new Set(to)) addTo(revealedAt, t, r);
    });
    rest.forEach((i, position) => {
        if (done[i]) return;
        if (restCells[position] < 0) {
            done[i] = 1;
            if (levelCells[i] >= 0) mech[i] = mechAt([levelCells[i]]);
            return;
        }
        const bumped = new Set(),
            cells = flood([restCells[position]], reached, bumped, { reveal: false, pocket: true }),
            pocketLevels = inSet(cells),
            mechanicsBits = mechAt(cells),
            members = new Set(pocketLevels),
            skyAbove = enteredFromSky(cells);
        const viaPad = new Set(),
            viaLevel = new Set(),
            hit = hitsIn(cells, revealedAt, revealers.length);
        revealers.forEach(([c], r) => {
            if (!hit[r] || cells.has(c)) return;
            const revealerPocket = pocketOf(c);
            for (const fi of revealerPocket.bumped) if (!bumped.has(fi)) viaPad.add(fi);
            for (const j of revealerPocket.levels) if (!members.has(j)) viaLevel.add(j);
        });
        for (const j of pocketLevels) {
            done[j] = 1;
            mech[j] = mechanicsBits;
            fromSky[j] = skyAbove ? 1 : 0;
            if (!first.has(j)) first.set(j, members);
            if (viaPad.size || viaLevel.size) viaPads.set(j, { gates: [...viaPad], levels: [...viaLevel] });
        }
        for (const fi of [...bumped, ...viaPad]) {
            const a = bucket(fi);
            for (const j of pocketLevels) if (frozenIn[j] === undefined) a.add(j);
        }
    });
    // a level in a closed gate's cell belongs to that gate alone, not to the pocket next to it
    for (const i of rest) {
        if (frozenIn[i] === undefined) continue;
        mech[i] = mechAt([levelCells[i]]);
        bucket(frozenIn[i]).add(i);
    }
    // `from`: for a level not reached that a closed gate on these lists needs, the levels behind that gate a walk from
    // the level reaches (levels frozen in a gate left out on both sides). A walk from it stays inside the first pocket it
    // is in, so only a level behind the gate in that pocket needs the walk.
    const from = new Map(),
        restPosition = new Map(rest.map((i, n) => [i, n]));
    for (const [fi, a] of byGate)
        for (const j of PROG.freezers[fi].req) {
            const position = restPosition.get(j),
                firstPocket = first.get(j);
            if (from.has(j) || position === undefined || !firstPocket || frozenIn[j] !== undefined) continue;
            if (![...a].some((i) => i !== j && firstPocket.has(i))) continue;
            const cells = flood([restCells[position]], reached, null);
            from.set(j, new Set(inSet(cells).filter((i) => frozenIn[i] === undefined)));
        }
    const lists = (edge) =>
        new Map([...byGate].filter(([fi]) => front.has(fi) === edge).map(([fi, a]) => [fi, [...a]]));
    return {
        level,
        leads: lists(true),
        pocket: lists(false),
        from,
        mech,
        fromSky,
        viaPads,
        dead: deadSeeds,
        cols: reachColumns(reached),
    };
}
// The reached cells projected onto the map: per map layer key a Uint8Array over the map's columns (row 0 = north, as in
// the layer images), 1 where a reached cell lies in the layer's z range; with heights, a Float32Array of the highest
// reached z per column instead, NaN where none
function reachColumns(reached, heights = false) {
    const map = PROG.map,
        [mapWidth, mapHeight] = map.size,
        [width, height] = PROG.world.grid.size,
        layerCells = width * height,
        out = Object.fromEntries(
            map.layers.map((l) => [
                l.key,
                heights ? new Float32Array(mapWidth * mapHeight).fill(NaN) : new Uint8Array(mapWidth * mapHeight),
            ]),
        ),
        byZ = new Map();
    const colsOf = (z) => {
        if (!byZ.has(z)) byZ.set(z, out[map.layers.find((l) => z >= l.z[0] && z < l.z[1])?.key]);
        return byZ.get(z);
    };
    for (const k of reached) {
        const column = k % layerCells,
            z = Math.floor(k / layerCells) - ZB,
            columns = colsOf(z);
        if (!columns) continue;
        const mapColumn = gridCol(column % width, Math.floor(column / width));
        if (!heights) columns[mapColumn] = 1;
        else if (!(columns[mapColumn] >= z)) columns[mapColumn] = z;
    }
    return out;
}
// Where the hero can stand in the level data (gates as stored, no ice gate closed, every teleporter on): a flood from
// every level entrance, teleporter and Area_Pin, as reachColumns heights. null until the world cells are loaded.
// scripts/build-walk.js stores them in data/walk.json for the page.
export function floorHeights() {
    if (!WORLD) return null;
    const teleporters = PROG.teleporters,
        { flood, land, padCell, cellOf } = walker(
            NO_HISTORY,
            teleporters.map(() => ({ en: true, disc: true })),
            [],
        );
    const seeds = [
        ...PROG.levels.map((l) => land(cellOf(...l.p))),
        ...teleporters.map((t, i) => padCell(i)),
        ...PROG.world.area_pins.map(([, x, y, z]) => land(cellOf(x, y, z), false)),
    ];
    return reachColumns(flood(seeds), true);
}
