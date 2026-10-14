// The walk model of one overworld state: the walker's grid, built step by step, and what the walker gives its callers
// (VIEWER.md "The walk model (viewer)")
import { PROG } from '../data.js';
import { latestFlag } from '../save.js';
import { placeAttacks } from './attacks.js';
import { placeGems, placeLights } from './beams.js';
import { placeBridges } from './bridges.js';
import { cellOf, mod, neighbourOf, ZB } from './cells.js';
import { placeElevators } from './elevator.js';
import { flood, noFloodState, placeTwins, revealedPadsOf, triggerIndex } from './flood.js';
import { freezeGates } from './freezers.js';
import { placeGates, placeNotPressers } from './gates.js';
import { withGroups } from './groups.js';
import { placeDrift, placeLilies, placeRivers } from './lilies-and-rivers.js';
import { mechAt, placeMechanics } from './mechanics.js';
import { magicMirrorHops } from './mirror-isles.js';
import { deep, placeWater } from './ocean.js';
import { heroLayerOf, heroSeed, placeTeleportDoors, placeWardrobes } from './skills.js';
import { skipLanes } from './skipping-stones.js';
import { skyEntrances } from './sky.js';
import { insideWall, land } from './support.js';
import { padCell, placePads } from './teleporters.js';
import { placeEntities, placeFences, placeVoxels } from './walls.js';

// A walker's grid: the cells of one overworld state and what stands in them, built once by walker() in place and read
// by its floods. Between floods only `frozen` changes (callers open and close ice gates in it); withGroups writes `grid`
// and `cellFlags` while it runs (`writeLog` undoes them) and names the Groups it makes exist in `groupsMade`;
// `visited` is the scratch of the flood that runs (`activeFlood`), and `noFlood` the state the helpers read when none
// runs.
function newWalkGrid(latest, teleporterStates, closed) {
    const world = PROG.world,
        gridData = world.grid,
        [cornerX, cornerY] = gridData.corner,
        [width, height] = gridData.size,
        layerCells = width * height,
        zOffset = gridData.zoff,
        layerCount = 256 - zOffset + ZB + 2,
        volume = layerCount * layerCells;
    // at and above z `boxZ` (the fast-travel map rooms) cells wrap inside the fast-travel box (grid columns
    // boxColumn..boxColumn+boxWidth-1, rows boxRow..boxRow+boxHeight-1) instead of the whole grid
    const fastTravel = gridData.ft;
    let boxZ = Infinity,
        boxWidth = width,
        boxHeight = height,
        boxColumn = 0,
        boxRow = 0;
    if (fastTravel) {
        boxZ = fastTravel.z;
        [boxWidth, boxHeight] = fastTravel.size;
        boxColumn = mod(fastTravel.corner[0] - cornerX, width);
        boxRow = mod(fastTravel.corner[1] - cornerY, height);
    }
    // existence Groups: whether each exists (its latest `exists`, else exists_by_default), the member pids' Group and
    // per Group the cell writes of its members that do not exist while it does not (`dormantWrites`, run by
    // withGroups) and the THROUGH lights its existence may power (`dormantLights`, run after the cell writes)
    const existenceGroups = world.egroups || [],
        groupExists = existenceGroups.map(([pid, byDefault]) => latestFlag(latest, pid, 'exists', byDefault)),
        groupOfMember = new Map();
    existenceGroups.forEach(([, , , , members], groupIndex) => {
        for (const pid of members) groupOfMember.set(pid, groupIndex);
    });
    return {
        latest,
        teleporterStates,
        closedFreezers: closed,
        world,
        teleporters: PROG.teleporters,
        cornerX,
        cornerY,
        width,
        height,
        layerCells,
        zOffset,
        layerCount,
        boxZ,
        boxWidth,
        boxHeight,
        boxColumn,
        boxRow,
        existenceGroups,
        groupExists,
        groupOfMember,
        dormantWrites: existenceGroups.map(() => []),
        dormantLights: existenceGroups.map(() => []),
        writeLog: null,
        groupsMade: null,
        grid: new Uint8Array(volume),
        cellFlags: new Uint8Array(volume),
        // the TELEPORT line's targets: the cells of the existing Rocks, living Monsters and movables other than Mirrors
        // (a Gem, Promesst_Light, Rover or Friendly_Dragon); `mirrorCells`: the Mirrors, which turn the line
        swapTargets: new Set(),
        mirrorCells: new Set(),
        // rock bridges, per Rock: [push cell, water cell] of each way to push it into water, where it sinks and holds the
        // hero up; `bridgeWater`: every bridge's water cell, which a pocket flood counts as floor whichever side the push
        // cell is on (flood option `pocket`)
        bridgesOf: new Map(),
        bridgeWater: new Set(),
        // an existing lily at its level-data place and where the save last left it; liliesAt: per cell, the Lilies that
        // hold the hero there (at these cells and along their drift)
        lilyCells: new Set(),
        liliesAt: new Map(),
        // per flavor, the cells of its existing Switches not pressed; latch: per flavor not all pressed, the cells its
        // presses change: `open`, its shut switch gates, and `shut`, its open notted gates
        unpressed: new Map(),
        latch: new Map(),
        // the closed ice gates: cell key -> freezer index
        frozen: new Map(),
        // water: per column the indices of the Ocean_Maps with water there, and per Ocean_Map whether it exists
        waterColumns: Array.from({ length: layerCells }),
        liveOceans: new Uint8Array(world.oceans.length),
        // the cells of THROUGH beams, and their solid cells, which a hero standing in the beam walks into
        throughBeam: new Set(),
        throughWalls: new Set(),
        // per cell of a powered beam, by its light's color: the ENDPOINT beams ({side, cells, index of the cell,
        // atInfinity as beamCells}), the number of DOUBLE beams, and whether an ALTER, a SQUEEZE or an OPEN beam runs
        // there; `litCells`: the cells of every beam and the lights themselves (the 'beam' hint)
        endpointBeams: new Map(),
        doubleBeams: new Map(),
        alterCells: new Set(),
        squeezeCells: new Set(),
        openBeamCells: new Set(),
        litCells: [],
        // per cell, the existing pads there and the elevator frames a step onto it rides to; the enabled, discovered
        // MAJOR pads; per pad, the existing world pads that reaching it reveals
        padsAt: new Map(),
        elevatorsAt: new Map(),
        teleporterIndex: new Map(PROG.teleporters.map((t, i) => [t.pid, i])),
        majorPads: null,
        revealedPads: [],
        // per Wardrobe cell its [door side, skill]; the attacked cells, and those of them a dragon's fire runs through
        wardrobes: new Map(),
        attacked: new Set(),
        burning: new Set(),
        // per room its Gem_Slots, and per cell its free Gems
        slotsByRoom: new Map(),
        gemsAt: new Map(),
        mirrorHops: null,
        driftHops: null,
        // per river cell, the side its current flows to; the cells the drifting Lilies pass
        flowSide: new Map(),
        driftCells: new Set(),
        // the cells of the skipping stones skipLanes() launches, and its lanes
        stoneCells: new Set(),
        lanes: null,
        teleportDoors: new Set(),
        // the cells of the objects that press no Switch
        notPressers: new Set(),
        heroLayer: 0,
        triggers: null,
        // per map-room pad, the world pads it targets; their cells; per cell, the pocket a flood from a pad cell found
        twinsOf: new Map(),
        twinCells: null,
        padComponents: new Map(),
        // per cell the unmodelled mechanics there (bit 1 << kind), and in it or next to it
        mechanics: new Map(),
        mechanicsNear: null,
        // the cells a flood has reached: bit p in layer p
        visited: new Uint8Array(volume),
        activeFlood: null,
        noFlood: noFloodState(),
    };
}
// The walk model for one overworld state: its latest values, teleporter states and the closed ice gates
// (closed[fi]). A model fitted to the saves, not the game's walk code: mirror reflections, magic Mirrors that share a
// room and vertical Beamcaster beams are not modelled; pushes are one cell (no chains, MULTIPUSH or PULL). Skipping
// stones carry the hero only by the TELEPORT swap onto their landing cell; a sunk one is a Rock that holds up the cell
// above it.
// flood(seeds, outside, front) never enters `outside` and adds each closed ice gate it bumps into to `front`; ice
// gates are opened and closed again by editing `frozen` (cell key -> freezer index). Floods run one at a time: they
// share the walker's visited cells.
export function walker(latest, teleporterStates, closed) {
    const walkGrid = newWalkGrid(latest, teleporterStates, closed);
    placeVoxels(walkGrid);
    const unmovedRocks = placeEntities(walkGrid);
    placeBridges(walkGrid, unmovedRocks);
    placeLilies(walkGrid);
    placeGates(walkGrid);
    placeFences(walkGrid);
    freezeGates(walkGrid);
    placeWater(walkGrid);
    placePads(walkGrid);
    placeElevators(walkGrid);
    placeWardrobes(walkGrid);
    placeAttacks(walkGrid);
    placeGems(walkGrid);
    placeLights(walkGrid);
    const { hops, driftHops } = magicMirrorHops(walkGrid);
    walkGrid.mirrorHops = hops;
    walkGrid.driftHops = driftHops;
    placeRivers(walkGrid);
    placeDrift(walkGrid);
    walkGrid.lanes = skipLanes(walkGrid);
    placeTeleportDoors(walkGrid);
    placeNotPressers(walkGrid);
    walkGrid.heroLayer = heroLayerOf(walkGrid);
    walkGrid.triggers = triggerIndex(walkGrid);
    placeTwins(walkGrid);
    walkGrid.revealedPads = revealedPadsOf(walkGrid);
    placeMechanics(walkGrid);
    return {
        flood: (seeds, outside, front, options) => flood(walkGrid, seeds, outside, front, options),
        skyEntrances: () => skyEntrances(walkGrid),
        land: (cell, up) => land(walkGrid, walkGrid.noFlood, cell, up),
        padCell: (ti) => padCell(walkGrid, walkGrid.noFlood, ti),
        withGroups: (groupIndices, callback) => withGroups(walkGrid, groupIndices, callback),
        deep: (cell) => deep(walkGrid, cell),
        shown: walkGrid.revealedPads,
        mechAt: (cells) => mechAt(walkGrid, cells),
        heroSeed: (position) => heroSeed(walkGrid, position),
        insideWall: (cell) => insideWall(walkGrid, cell),
        fire: walkGrid.attacked,
        beam: walkGrid.throughBeam,
        thru: walkGrid.throughWalls,
        openBeam: walkGrid.openBeamCells,
        lanes: walkGrid.lanes,
        hops: walkGrid.mirrorHops,
        driftHops: walkGrid.driftHops,
        cellOf: (x, y, z) => cellOf(walkGrid, x, y, z),
        neighbourOf: (cell, dx, dy) => neighbourOf(walkGrid, cell, dx, dy),
        frozen: walkGrid.frozen,
        width: walkGrid.width,
        layerCells: walkGrid.layerCells,
    };
}
