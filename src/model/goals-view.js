// The goals ladder as the page shows it, nothing under fog named or counted (VIEWER.md "Goals (viewer)")
import { PROG } from '../data.js';
import { prettyAch } from '../util.js';
import { hasAchievement } from './achievements.js';
import { goalRoutes, roleFor } from './goal-roles.js';
import { roleOf } from './level-roles.js';
import { levelGroup, orderNextSteps } from './next-steps.js';
import { towerName } from './towers.js';

// The goals ladder as the page shows it (VIEWER.md "Goals (viewer)"), from progress.goals:
// - goals: per goal key, kind, label, done, active, progress ([got, total], null for an ending), left (what is still to
//   do, in `unit`: an ending's plan steps, else towers, achievements or levels), fogged (more of it is under fog) and,
//   for the towers and the achievements, the children not under fog;
// - goalLevels(goal): the unsolved levels not under fog that serve the goal, in list order, each with its group
//   (levelGroup), its role for the goal, what it leads to and whether it is on the goal's cheapest plans;
// - goalSolved(goal): the solved levels not under fog in the goal's scope;
// - goalByKey(key) and goalFor(key): a goal by key, and the one the page shows (that one, else the active one).
// Nothing under fog is named or counted: the endings are listed by their public achievement names, each once the one
// before it is earned; counts leave out what fog hides, as the totals do.
export function goalsView(view) {
    const {
        status,
        progress,
        levels,
        endings,
        achievementHidden,
        achievementRule,
        gateShown,
        gateArea,
        stepShown,
        heroDist,
    } = view;
    const plans = progress.plans,
        graph = plans.G;
    const towerShown = (ti) => !progress.towerHidden[ti];
    const towerLeft = (ti) => Math.max(0, progress.towers[ti].req - progress.towers[ti].solvedNormal);
    const gateName = (fi) => gateArea(fi) ?? `at ${PROG.freezers[fi].p[0]}, ${PROG.freezers[fi].p[1]}`;
    const levelId = (i) => graph.index.get('l' + i);

    // the levels in a requirement's plan (just itself for a level with none)
    const planLevels = (id, into) => {
        if (id === undefined) return;
        if (plans.settled[id] < 0) {
            if (graph.node[id]?.t === 'l') into.add(graph.node[id].id);
            return;
        }
        for (const step of plans.steps[id]) if (graph.node[step]?.t === 'l') into.add(graph.node[step].id);
    };
    // a tower's unsolved normal levels and their plans
    const towerLevels = (ti, into) => {
        for (const j of progress.towers[ti].normal) {
            if (progress.state[j] === 'solved') continue;
            into.add(j);
            planLevels(levelId(j), into);
        }
    };
    // the levels that serve a goal: an ending's are on its routes (its roles), a tower's and an achievement's are its
    // levels and their plans, Completionist's every level; the towers and the achievements gather their children's
    const levelsOf = (goal) => {
        const into = new Set();
        if (goal.kind === 'ending') {
            levels.forEach((l, i) => {
                if (goal.roles.l[i]) into.add(i);
            });
        } else if (goal.kind === 'tower') {
            towerLevels(goal.tower, into);
        } else if (goal.kind === 'achievement') {
            for (const id of goal.targets) {
                if (graph.node[id]?.t === 't') towerLevels(graph.node[id].id, into);
                else planLevels(id, into);
            }
        } else if (goal.kind === 'completionist') {
            levels.forEach((l, i) => into.add(i));
        } else {
            for (const child of goal.children) if (!child.done) for (const i of levelsOf(child)) into.add(i);
        }
        return into;
    };

    // what a requirement on a goal's chain says a level leads to, null when it says nothing or is under fog
    const describe = (id, below) => {
        const node = graph.node[id];
        if (!node) return null;
        if (node.t === 't') {
            if (!towerShown(node.id)) return null;
            return `${towerName(progress.towers[node.id].t)} · ${towerLeft(node.id)} to go`;
        }
        if (node.t === 'g') {
            if (!gateShown(node.id)) return null;
            return `opens ice gate ${gateName(node.id)}`;
        }
        if (node.t === 'l') {
            if (progress.hidden[node.id]) return null;
            const unlocked = graph.node[below]?.t === 'l' && levels[node.id].req.includes(graph.node[below].id);
            if (unlocked) return `unlocks ${levels[node.id].n}`;
            return `opens the way to ${levels[node.id].n}`;
        }
        if (node.t === 'e') {
            if (achievementHidden(node.id)) return null;
            return prettyAch(node.id);
        }
        return null;
    };
    // " · one of 3 routes" for a level on some routes only, counting the routes not under fog
    const routesText = (goal, id) => {
        const junction = goal.roles.weakAt[id];
        if (junction < 0 || graph.kind[junction] !== 'or') return '';
        const routes = goalRoutes(plans, junction);
        const shown = routes.filter((route) => !graph.node[route] || stepShown(graph.node[route])).length;
        if (shown >= 2) return ` · one of ${shown} routes`;
        if (routes.length >= 2) return ' · one of several routes';
        return '';
    };
    // a level leads to the nearest thing not under fog on its chain toward the goal: a tower and the levels it has left,
    // an ice gate, a level it unlocks or opens the way to, a rank marker; else to the goal itself
    const leadsTo = (goal, i) => {
        if (goal.kind === 'completionist') return goalOf(i);
        const id = levelId(i),
            { from, need } = goal.roles;
        if (!need[id]) return '';
        let below = id;
        for (let x = from[id]; x >= 0; x = from[x]) {
            const text = describe(x, below);
            if (text) return text + routesText(goal, id);
            if (graph.node[x]) below = x;
        }
        return goal.label + routesText(goal, id);
    };
    // the levels on the goal's cheapest plans: every level for Completionist, which asks for them all
    const onPlanLevels = (goal) => {
        const into = new Set();
        if (goal.kind === 'completionist') return null;
        for (const id of goal.targets) planLevels(id, into);
        return into;
    };
    const shownForOrder = { level: (j) => !progress.hidden[j], gate: gateShown, tower: towerShown, dist: heroDist };
    const goalLevels = (goal) => {
        const ids = [...levelsOf(goal)].filter((i) => progress.state[i] !== 'solved' && !progress.hidden[i]);
        const onPlan = onPlanLevels(goal);
        return orderNextSteps(progress, ids, shownForOrder, goal).map((i) => ({
            i,
            group: levelGroup(progress.state[i]),
            role: roleFor(goal, 'l', i),
            leadsTo: leadsTo(goal, i),
            onPlan: !onPlan || onPlan.has(i),
        }));
    };
    // the solved levels not under fog in a goal's scope: a tower's or an achievement's own levels, every one for the rest
    const solvedLevelsOf = (goal, into) => {
        if (goal.kind === 'tower') {
            for (const j of progress.towers[goal.tower].normal) into.add(j);
        } else if (goal.kind === 'achievement') {
            const rule = achievementRule(goal.name);
            for (const j of rule?.tower?.normal || rule?.levels || []) into.add(j);
        } else if (goal.kind === 'towers' || goal.kind === 'achievements') {
            for (const child of goal.children) solvedLevelsOf(child, into);
        } else {
            levels.forEach((l, i) => into.add(i));
        }
    };
    const goalSolved = (goal) => {
        const into = new Set();
        solvedLevelsOf(goal, into);
        return [...into].filter((i) => progress.state[i] === 'solved' && !progress.hidden[i]).toSorted((a, b) => a - b);
    };

    // why a Next steps level is next, as the goals it leads to (none under fog): the next ending with the tower it brings closest to done, else that tower, else an achievement, else the first Required level or
    // ice gate after it
    const reqShown = (kind, id) => {
        const shown = kind === 'l' ? !progress.hidden[id] : gateShown(id);
        return shown && roleOf(kind, id) === 'req';
    };
    const goalOf = (i) => {
        const nd = progress.needed[i];
        if (!nd) return '';
        let ending = '';
        if (nd.ending != null && endings[nd.ending].shown) ending = `Toward ${prettyAch(endings[nd.ending].name)}`;
        const tower = nd.towers.filter(([ti]) => towerShown(ti)).toSorted((a, b) => a[1] - b[1])[0];
        const towerGoal = tower ? `${towerName(progress.towers[tower[0]].t)} · ${tower[1]} to go` : '';
        if (ending && towerGoal) return `${ending} · ${towerGoal}`;
        if (ending) return ending;
        if (towerGoal) return towerGoal;
        const down = [...nd.down].map((k) => [k[0], Number(k.slice(1))]);
        const achievementLevel = [i, ...down.filter(([kind]) => kind === 'l').map(([, j]) => j)].find(
            (j) => levels[j].a && !progress.hidden[j] && !hasAchievement(status, levels[j].a),
        );
        if (achievementLevel != null) return prettyAch(levels[achievementLevel].a);
        const required = down.filter(([kind, j]) => reqShown(kind, j));
        if (required.length) {
            const [kind, j] = required[0];
            const more = required.length > 1 ? ` +${required.length - 1}` : '';
            if (kind === 'l') return `Required ${levels[j].n}${more}`;
            const area = gateArea(j);
            return `Required ice gate${area != null ? ' · ' + area : ''}${more}`;
        }
        if (roleOf('l', i) === 'req') return 'Required level';
        return '';
    };

    // an ending: its plan steps left that fog does not hide (its own level included)
    const stepsLeft = (goal) => {
        if (goal.done) return { left: 0, fogged: false };
        const id = goal.targets[0];
        if (id === undefined || plans.settled[id] < 0) return { left: null, fogged: false };
        let left = 0,
            fogged = false;
        for (const step of plans.steps[id]) {
            if (stepShown(graph.node[step])) left++;
            else fogged = true;
        }
        return { left, fogged };
    };
    const base = (raw, label, goalProgress, unit, fogged = false) => ({
        key: raw.key,
        kind: raw.kind,
        label,
        done: raw.done,
        active: raw.active,
        progress: goalProgress,
        left: goalProgress ? goalProgress[1] - goalProgress[0] : null,
        unit,
        fogged,
        targets: raw.targets,
        roles: raw.roles,
        tower: raw.tower,
        name: raw.name,
        ending: raw.ending,
    });
    const endingGoal = (raw) => {
        const goal = base(raw, prettyAch(raw.name), null, 'steps');
        const { left, fogged } = stepsLeft(raw);
        goal.left = left;
        goal.fogged = fogged;
        return goal;
    };
    const towerGoal = (raw) => {
        const t = progress.towers[raw.tower];
        return base(raw, towerName(t.t), [Math.min(t.solvedNormal, t.req), t.req], 'levels');
    };
    const achievementGoal = (raw) => {
        const rule = achievementRule(raw.name);
        let goalProgress = [raw.done ? 1 : 0, 1],
            unit = 'achievements';
        if (rule?.tower) {
            goalProgress = [Math.min(rule.tower.solvedNormal, rule.tower.req), rule.tower.req];
            unit = 'levels';
        } else if (rule?.levels) {
            goalProgress = [rule.levels.filter((i) => progress.state[i] === 'solved').length, rule.levels.length];
            unit = 'levels';
        }
        if (raw.done) goalProgress = [goalProgress[1], goalProgress[1]];
        return base(raw, prettyAch(raw.name), goalProgress, unit);
    };
    // the towers and the achievements count the children not under fog, as the totals do
    const parentGoal = (raw, label, unit, childShown, childGoal) => {
        const shown = raw.children.filter(childShown);
        const children = shown.map(childGoal);
        const firstOpen = children.find((child) => !child.done);
        for (const child of children) child.active = child === firstOpen;
        const done = children.filter((child) => child.done).length;
        const goal = base(raw, label, [done, children.length], unit, shown.length < raw.children.length);
        goal.children = children;
        return goal;
    };
    const completionistGoal = (raw) => {
        const shown = levels.filter((l, i) => !progress.hidden[i]).length;
        const fogged = shown < levels.length;
        return base(raw, prettyAch('COMPLETIONIST'), [progress.solved, shown], 'levels', fogged);
    };
    const listed = (progress.goals || []).filter((raw) => raw.kind !== 'ending' || endings[raw.ending].shown);
    const goals = listed.map((raw) => {
        if (raw.kind === 'ending') return endingGoal(raw);
        if (raw.kind === 'towers')
            return parentGoal(raw, 'Towers', 'towers', (child) => towerShown(child.tower), towerGoal);
        if (raw.kind === 'achievements')
            return parentGoal(
                raw,
                'Achievements',
                'achievements',
                (child) => !achievementHidden(child.name),
                achievementGoal,
            );
        return completionistGoal(raw);
    });
    // a goal by its key, a child of the towers or the achievements too; null when none has it (a tower now under fog)
    const goalByKey = (key) => {
        for (const goal of goals) {
            if (goal.key === key) return goal;
            const child = goal.children?.find((each) => each.key === key);
            if (child) return child;
        }
        return null;
    };
    // the goal the list and the map show: the one picked by key, else the active one, else the last (every goal done)
    const goalFor = (key) => goalByKey(key) || goals.find((goal) => goal.active) || goals.at(-1) || null;
    return { goals, goalLevels, goalSolved, goalByKey, goalFor };
}
