// The goals ladder (VIEWER.md "Goals (viewer)")
import { PROG } from '../data.ts';
import { achievementNames, achievementRules, ENDINGS, hasAchievement } from './achievements.ts';
import { goalRoles, routeGraph } from './goal-roles.ts';
import type { GoalRoles } from './goal-roles.ts';
import type { BaseProgress } from './progress.ts';
import type { Plans } from './plans.ts';

interface GoalCore {
    key: string;
    done: boolean;
    /** The requirement ids it asks for; none once done. */
    targets: number[];
    /** The first goal of its list that is not done. */
    active: boolean;
    roles?: GoalRoles;
}

/**
 * One of the three endings, in rank order; the first has the ground towers' Antipode teleporters as children, the
 * second its stages in order: the sky towers whose Signs open Freezers among the places and levels around them.
 */
export interface EndingGoal extends GoalCore {
    kind: 'ending';
    ending: number;
    name: string;
    children?: Array<AntipodeGoal | TowerGoal | StageGoal>;
}

/** The stages of the second ending that are no tower. */
export type StageName = 'crossroads' | 'antipode' | 'room' | 'final';

/**
 * A stage of the second ending: the sky crossroads (`area`), the sky hub (`area`), the end2 room's level or the level
 * that earns the ending (`level`).
 */
export interface StageGoal extends GoalCore {
    kind: 'stage';
    stage: StageName;
    area?: number;
    level?: number;
}

export interface TowerGoal extends GoalCore {
    kind: 'tower';
    tower: number;
}

/** A ground tower's Antipode teleporter. */
export interface AntipodeGoal extends GoalCore {
    kind: 'antipode';
    tower: number;
    room: number;
}

export interface AchievementGoal extends GoalCore {
    kind: 'achievement';
    name: string;
}

export interface AchievementsGoal extends GoalCore {
    kind: 'achievements';
    children: AchievementGoal[];
}

export interface CompletionistGoal extends GoalCore {
    kind: 'completionist';
}

export type LadderGoal = EndingGoal | AchievementsGoal | CompletionistGoal;

export type GoalKind =
    | LadderGoal['kind']
    | TowerGoal['kind']
    | AntipodeGoal['kind']
    | AchievementGoal['kind']
    | StageGoal['kind'];

// the sky areas of the first two stages, and the end2 room's level, by name
const CROSSROADS_AREA = 'area_s_upper_crossroads';
const HUB_AREA = 'area_s_antipode_high';
const ROOM_LEVEL = 'laser_pointer';

// marks the first goal of a list not done as the active one
function markActive(goals: Array<{ done: boolean; active: boolean }>): void {
    const first = goals.find((goal) => !goal.done);
    if (first) first.active = true;
}

/** The towers whose Signs open Freezers, each with the Freezers its Signs open. */
export function freezerTowers(): Map<number, number[]> {
    const gatesOf = new Map<number, number[]>();

    for (const sign of PROG.signs || []) {
        if (sign.tower == null || !sign.gates.length) continue;

        const gates = gatesOf.get(sign.tower) ?? [];
        gates.push(...sign.gates);
        gatesOf.set(sign.tower, gates);
    }

    return gatesOf;
}

/**
 * The goals ladder (VIEWER.md "Goals (viewer)"), without fog: the three endings in rank order, the achievements,
 * Completionist. Per goal: key, kind, done, active (the first goal not done), targets (the requirement ids it asks for),
 * roles (goalRoles over the targets) and, for the achievements, children of the same shape: one per achievement but
 * Completionist, which is a goal of its own. The first ending has one child per ground tower (the towers with an
 * Antipode teleporter, which its Sign counts), the second its stages in order.
 */
export function goalLadder(progress: BaseProgress & { plans: Plans }, status: { achievements: bigint }): LadderGoal[] {
    const levels = PROG.levels;
    const plans = progress.plans;
    const rules = achievementRules(progress);

    const idsOf = (keys: string[]) => {
        const ids = keys.map((key) => plans.G.index.get(key));
        return ids.filter((id) => id !== undefined);
    };

    const unsolved = (levelIds: number[]) => levelIds.filter((i) => progress.state[i] !== 'solved');
    const goal = <Fields extends { key: string; kind: GoalKind; done: boolean }>(
        fields: Fields,
        targetKeys: string[],
    ): Fields & { targets: number[]; active: boolean } => {
        const targets = fields.done ? [] : idsOf(targetKeys);
        return { ...fields, targets, active: false };
    };

    const endings = ENDINGS.map(([, name], ending): EndingGoal => {
        const level = levels.findIndex((candidate) => candidate.a === name);
        const targetKeys = level >= 0 ? ['l' + level] : [];
        return goal(
            { key: 'ending:' + name, kind: 'ending', ending, name, done: hasAchievement(status, name) },
            targetKeys,
        );
    });

    const towerGoals = progress.towers.map((tower, towerIndex): TowerGoal =>
        goal({ key: 'tower:' + towerIndex, kind: 'tower', tower: towerIndex, done: tower.active }, ['t' + towerIndex]),
    );

    // a ground tower's goal asks for its Antipode teleporter: its levels while it is not activated, then the step onto
    // its pad, done once the teleporter's endpoint is discovered
    const rooms = PROG.gold_rooms || [];
    const antipodeGoals: AntipodeGoal[] = [];

    for (const [room, goldRoom] of rooms.entries()) {
        const tower = goldRoom.tower;
        if (!progress.towers[tower]) continue;

        const visited = progress.tst[goldRoom.endpoint].disc;
        antipodeGoals.push(goal({ key: 'tower:' + tower, kind: 'antipode', tower, room, done: visited }, ['p' + room]));
    }

    antipodeGoals.sort((first, second) => first.tower - second.tower);

    // the second ending's stages in order (VIEWER.md "Goals (viewer)"): the crossroads, the sky towers (each done once
    // its tower is activated and its hub Freezers are open), the hub, the end2 room's level, the ending's level
    const gateTowers = freezerTowers();
    const isOpen = (gates: number[]) => gates.every((gate) => progress.gateOpen[gate]);
    const closedKeys = (gates: number[]) => gates.filter((gate) => !progress.gateOpen[gate]).map((gate) => 'g' + gate);
    const areaIndex = (name: string) => (PROG.areas || []).findIndex((area) => area.local_area_name === name);
    const stages: Array<StageGoal | TowerGoal> = [];

    const crossroads = areaIndex(CROSSROADS_AREA);
    if (crossroads >= 0) {
        stages.push(
            goal(
                {
                    key: 'stage:crossroads',
                    kind: 'stage',
                    stage: 'crossroads',
                    area: crossroads,
                    done: hasAchievement(status, 'ASCEND'),
                },
                ['e:ASCEND'],
            ),
        );
    }

    const hubGates: number[] = [];
    const sortedTowers = [...gateTowers.keys()].toSorted((first, second) => first - second);
    for (const towerIndex of sortedTowers) {
        const gates = gateTowers.get(towerIndex)!;
        hubGates.push(...gates);

        const done = progress.towers[towerIndex].active && isOpen(gates);
        stages.push(goal({ key: 'tower:' + towerIndex, kind: 'tower', tower: towerIndex, done }, closedKeys(gates)));
    }

    const hub = areaIndex(HUB_AREA);
    if (hub >= 0 && hubGates.length) {
        stages.push(
            goal(
                { key: 'stage:antipode', kind: 'stage', stage: 'antipode', area: hub, done: isOpen(hubGates) },
                closedKeys(hubGates),
            ),
        );
    }

    const roomLevel = levels.findIndex((candidate) => candidate.n === ROOM_LEVEL);
    if (roomLevel >= 0) {
        const done = progress.state[roomLevel] === 'solved';
        stages.push(
            goal({ key: 'stage:room', kind: 'stage', stage: 'room', level: roomLevel, done }, ['l' + roomLevel]),
        );
    }

    const finalLevel = levels.findIndex((candidate) => candidate.a === 'ENDGAME2');
    if (finalLevel >= 0) {
        const done = progress.state[finalLevel] === 'solved';
        stages.push(
            goal({ key: 'stage:final', kind: 'stage', stage: 'final', level: finalLevel, done }, ['l' + finalLevel]),
        );
    }

    // an achievement asks for its tower, its levels, or its rank marker (ASCEND, DESCEND)
    const achievementKeys = (name: string) => {
        const rule = rules.get(name);
        if (!rule) return [];
        if (rule.tower) return ['t' + progress.towers.indexOf(rule.tower)];
        if (rule.levels) return unsolved(rule.levels).map((i) => 'l' + i);
        return ['e:' + name];
    };

    const achievementGoals = achievementNames()
        .filter((name) => name !== 'COMPLETIONIST')
        .map((name): AchievementGoal =>
            goal(
                { key: 'achievement:' + name, kind: 'achievement', name, done: hasAchievement(status, name) },
                achievementKeys(name),
            ),
        );

    const parent = <Fields extends { key: string; kind: GoalKind }, Child extends GoalCore>(
        fields: Fields,
        children: Child[],
    ): Fields & { done: boolean; targets: number[]; active: boolean; children: Child[] } => ({
        ...fields,
        done: children.every((child) => child.done),
        targets: children.flatMap((child) => child.targets),
        active: false,
        children,
    });

    const achievements: AchievementsGoal = parent({ key: 'achievements', kind: 'achievements' }, achievementGoals);
    if (endings.length && antipodeGoals.length) endings[0].children = antipodeGoals;

    if (endings.length > 1 && stages.some((stage) => stage.kind === 'tower')) endings[1].children = stages;

    const levelsLeft = unsolved([...levels.keys()]);
    const completionist: CompletionistGoal = goal(
        {
            key: 'completionist',
            kind: 'completionist',
            done: hasAchievement(status, 'COMPLETIONIST') || !levelsLeft.length,
        },
        levelsLeft.map((i) => 'l' + i),
    );

    const goals: LadderGoal[] = [...endings, achievements, completionist];
    const graph = routeGraph(plans);
    for (const ladderGoal of [...goals, ...towerGoals, ...antipodeGoals, ...stages]) {
        ladderGoal.roles = goalRoles(plans, graph, ladderGoal.targets);
    }

    // a tower's or an ending's achievement asks for the same as that goal
    for (const achievementGoal of achievementGoals) {
        const rule = rules.get(achievementGoal.name);
        const ending = endings.find((goalOfEnding) => goalOfEnding.name === achievementGoal.name);
        if (rule?.tower) {
            achievementGoal.roles = towerGoals[progress.towers.indexOf(rule.tower)].roles;
        } else if (ending) {
            achievementGoal.roles = ending.roles;
        } else {
            achievementGoal.roles = goalRoles(plans, graph, achievementGoal.targets);
        }
    }

    markActive(goals);
    markActive(antipodeGoals);
    markActive(stages);
    markActive(achievementGoals);
    return goals;
}

/** The goal the ladder starts at: the first one not done, else null. */
export const activeGoal = <Goal extends { active: boolean }>(goals: Goal[] | null | undefined): Goal | null =>
    goals?.find((goal) => goal.active) || null;
