// The goals ladder (VIEWER.md "Goals (viewer)")
import { PROG } from '../data.js';
import { achievementNames, achievementRules, ENDINGS, hasAchievement } from './achievements.js';
import { goalRoles, routeGraph } from './goal-roles.js';

// marks the first goal of a list not done as the active one
function markActive(goals) {
    const first = goals.find((goal) => !goal.done);
    if (first) first.active = true;
}

// The goals ladder (VIEWER.md "Goals (viewer)"), without fog: the three endings in rank order, the towers, the
// achievements, Completionist. Per goal: key, kind, done, active (the first goal not done), targets (the requirement ids
// it asks for), roles (goalRoles over the targets) and, for the towers and the achievements, children of the same shape:
// one per tower, one per achievement but Completionist, which is a goal of its own.
export function goalLadder(progress, status) {
    const levels = PROG.levels,
        plans = progress.plans,
        rules = achievementRules(progress);
    const idsOf = (keys) => keys.map((key) => plans.G.index.get(key)).filter((id) => id !== undefined);
    const unsolved = (levelIds) => levelIds.filter((i) => progress.state[i] !== 'solved');
    const goal = (fields, targetKeys) => ({ ...fields, targets: fields.done ? [] : idsOf(targetKeys), active: false });
    const endings = ENDINGS.map(([, name], ending) => {
        const level = levels.findIndex((l) => l.a === name);
        const targetKeys = level >= 0 ? ['l' + level] : [];
        return goal(
            { key: 'ending:' + name, kind: 'ending', ending, name, done: hasAchievement(status, name) },
            targetKeys,
        );
    });
    const towerGoals = progress.towers.map((t, ti) =>
        goal({ key: 'tower:' + ti, kind: 'tower', tower: ti, done: t.active }, ['t' + ti]),
    );
    // an achievement asks for its tower, its levels, or its rank marker (ASCEND, DESCEND)
    const achievementKeys = (name) => {
        const rule = rules.get(name);
        if (!rule) return [];
        if (rule.tower) return ['t' + progress.towers.indexOf(rule.tower)];
        if (rule.levels) return unsolved(rule.levels).map((i) => 'l' + i);
        return ['e:' + name];
    };
    const achievementGoals = achievementNames()
        .filter((name) => name !== 'COMPLETIONIST')
        .map((name) =>
            goal(
                { key: 'achievement:' + name, kind: 'achievement', name, done: hasAchievement(status, name) },
                achievementKeys(name),
            ),
        );
    const parent = (fields, children) => ({
        ...fields,
        done: children.every((child) => child.done),
        targets: children.flatMap((child) => child.targets),
        active: false,
        children,
    });
    const towers = parent({ key: 'towers', kind: 'towers' }, towerGoals);
    const achievements = parent({ key: 'achievements', kind: 'achievements' }, achievementGoals);
    const levelsLeft = unsolved(levels.map((l, i) => i));
    const completionist = goal(
        {
            key: 'completionist',
            kind: 'completionist',
            done: hasAchievement(status, 'COMPLETIONIST') || !levelsLeft.length,
        },
        levelsLeft.map((i) => 'l' + i),
    );
    const goals = [...endings, towers, achievements, completionist];
    const graph = routeGraph(plans);
    for (const each of [...goals, ...towerGoals]) each.roles = goalRoles(plans, graph, each.targets);
    // a tower's or an ending's achievement asks for the same as that goal
    for (const each of achievementGoals) {
        const rule = rules.get(each.name);
        const ending = endings.find((goalOfEnding) => goalOfEnding.name === each.name);
        if (rule?.tower) each.roles = towerGoals[progress.towers.indexOf(rule.tower)].roles;
        else if (ending) each.roles = ending.roles;
        else each.roles = goalRoles(plans, graph, each.targets);
    }
    markActive(goals);
    markActive(towerGoals);
    markActive(achievementGoals);
    return goals;
}

// The goal the ladder starts at: the first one not done, else null
export const activeGoal = (goals) => goals?.find((goal) => goal.active) || null;
