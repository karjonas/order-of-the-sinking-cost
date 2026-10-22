// The hand-written table of known routes: routes the walk does not find, with what each asks for (VIEWER.md "Known
// routes"), and the resolving of its names and pids to the indices data/progress.json holds.
import type {
    Area,
    Freezer,
    KnownRoute,
    Position,
    ProgressLevel,
    RouteNeed,
    RouteTarget,
    Sign,
    Teleporter,
} from '../../src/types.ts';

type NeedSource = { level: string } | { freezer: number } | { sign: number };
type TargetSource = { level: string } | { pid: number };

/**
 * One row of the table. `needs`: all of the groups, one of the needs inside a group; a need is a level (by name)
 * solved, a Freezer (by pid) open or a Sign (by pid) read. An empty group is a need that is not known: nothing meets
 * it. `to`: the level (by name) whose entrance the hero reaches, or the overworld entity (by pid) whose cell he
 * reaches. `area` and `tower` (a tower flag name such as HEROES) mark a sky Way: the Way area (by local area name) that
 * leads to the hub quarter of the sky tower, whose hub pad is `to`.
 */
interface KnownRouteSource {
    id: string;
    to: TargetSource;
    needs: NeedSource[][];
    area?: string;
    tower?: string;
    note?: string;
}

const KNOWN_ROUTES: KnownRouteSource[] = [
    {
        id: 'heroes_way',
        to: { pid: 106958293 },
        needs: [[{ level: 'catching_fire_v2' }]],
        area: 'area_s_heroes_way',
        tower: 'HEROES',
    },
    {
        id: 'mirror_way',
        to: { pid: 106958295 },
        needs: [[{ level: 'priest_3d_intro_dragon_v4' }]],
        area: 'area_s_mirror_way',
        tower: 'MIRRORS',
    },
    {
        id: 'skipping_way',
        to: { pid: 106958297 },
        needs: [[]],
        area: 'area_s_skipping_way',
        tower: 'SKIPPING',
        note: 'what the route asks for is not known',
    },
    {
        id: 'beam_way',
        to: { pid: 106958291 },
        needs: [[{ level: 'high_endpoint_v2' }], [{ level: 'beam_jail_v3' }, { level: 'thin_ice_rooms' }]],
        area: 'area_s_beam_way',
        tower: 'PROMESST',
    },
    {
        id: 'green_hat_rock_stair',
        to: { level: 'green_hat' },
        needs: [[{ level: 'sokobridge_v4' }]],
        note: 'the Rock sokobridge_v4 frees is pushed off the ledge and lands as a stair up to the level',
    },
    {
        id: 'double_the_fun_gem_step',
        to: { level: 'double_the_fun' },
        needs: [[{ level: 'taking_the_lift' }]],
        note: 'the Gem taking_the_lift frees is pushed beside the 1-high pillar the level stands on, as a step up',
    },
    {
        id: 'sender_simplified_gem_slot',
        to: { level: 'sender_simplified_v2' },
        needs: [[{ level: 'landmines_v3' }]],
        note: 'the Gem landmines_v3 frees goes onto its Gem_Slot; the lights it powers open the way down to the level',
    },
    {
        id: 'all_together_now_cup',
        to: { level: 'all_together_now' },
        needs: [
            [{ level: 'chart_a_course' }],
            [{ freezer: 95568981 }],
            [{ freezer: 95568982 }],
            [{ freezer: 95568983 }],
            [{ freezer: 95568984 }],
        ],
        note: 'from the end2 room, which the sky hub Freezers open: the vertical magic Mirror and the Rock chart_a_course frees are pushed east, and the Rock in the corner cup bridges the deck to the level',
    },
    {
        id: 'push_down_chain_ride',
        to: { level: 'push_down_chain' },
        needs: [[{ level: 'promesst2.5_deeper' }]],
        note: 'the light promesst2.5_deeper frees smashes the Rock stack on the elevator, which then carries the hero down to the level',
    },
];

/** What the names and pids of the table resolve against. */
export interface RouteData {
    levels: ProgressLevel[];
    freezers: Freezer[];
    signs: Sign[];
    areas: Area[];
    teleporters: Teleporter[];
    /** The index into `towers` of the sky tower with this flag name. */
    skyTower: (flagName: string) => number | undefined;
    /** The position of the overworld entity with this pid. */
    positionOf: (pid: number) => Position | undefined;
}

function indexOrThrow(index: number, what: string): number {
    if (index < 0) throw new Error(`known_routes: no ${what}`);
    return index;
}

function resolveNeed(source: NeedSource, data: RouteData): RouteNeed {
    if ('level' in source) {
        const level = data.levels.findIndex((candidate) => candidate.n === source.level);
        return { level: indexOrThrow(level, `level ${source.level}`) };
    }

    if ('freezer' in source) {
        const freezer = data.freezers.findIndex((candidate) => candidate.pid === source.freezer);
        return { freezer: indexOrThrow(freezer, `Freezer ${source.freezer}`) };
    }

    const sign = data.signs.findIndex((candidate) => candidate.pid === source.sign);
    return { sign: indexOrThrow(sign, `Sign ${source.sign}`) };
}

function resolveTarget(source: TargetSource, data: RouteData): RouteTarget {
    if ('level' in source) {
        const level = data.levels.findIndex((candidate) => candidate.n === source.level);
        return { level: indexOrThrow(level, `level ${source.level}`) };
    }

    const pad = data.teleporters.findIndex((candidate) => candidate.pid === source.pid);
    if (pad >= 0) return { pad };

    const at = data.positionOf(source.pid);
    if (at === undefined) throw new Error(`known_routes: no overworld entity ${source.pid}`);
    return { at };
}

function resolveRoute(source: KnownRouteSource, data: RouteData): KnownRoute {
    const route: KnownRoute = {
        id: source.id,
        to: resolveTarget(source.to, data),
        needs: source.needs.map((group) => group.map((need) => resolveNeed(need, data))),
    };

    if (source.area !== undefined) {
        const area = data.areas.findIndex((candidate) => candidate.local_area_name === source.area);
        route.area = indexOrThrow(area, `area ${source.area}`);
    }

    if (source.tower !== undefined) {
        const tower = data.skyTower(source.tower);
        if (tower === undefined) throw new Error(`known_routes: no sky tower ${source.tower}`);
        route.tower = tower;
    }

    return route;
}

/** The table with its names and pids resolved to indices; a name or pid the data lacks fails the build. */
export function buildKnownRoutes(data: RouteData): KnownRoute[] {
    return KNOWN_ROUTES.map((source) => resolveRoute(source, data));
}
