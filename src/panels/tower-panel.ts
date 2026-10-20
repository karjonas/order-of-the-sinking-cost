// A tower's panel on the map: activated or how many to go, the path to activate it, its unsolved, solved and dropdown
// levels (VIEWER.md "The page (viewer)")
import { escapeHtml } from '../util.ts';
import type { MapLink, SelectHow } from '../map/map-view.ts';
import { unlockPlan } from '../model/plans.ts';
import { towerEmblemHtml } from '../map/icons.ts';
import { towerLevelCount, towerName } from '../model/towers.ts';
import type { TowerProgress } from '../model/towers.ts';
import type { PanelContext } from './context.ts';
import { markSelected } from './list.ts';
import { chainOf, layerNote, panelHead, pathHtml, pick, pointsOf, stepsOf, uniqueLinks } from './plan-chips.ts';

// the count of a tower's levels; while some are under fog only the ones not under fog are counted, and the count
// says there are more
function towerStateHtml(tower: TowerProgress, shownLevels: number, unsolvedShown: number): string {
    const fogged = shownLevels < tower.normal.length;
    let toGo = String(Math.max(0, tower.req - tower.solvedNormal));
    if (fogged) toGo = `${unsolvedShown}+`;

    let state = `<span class="chip">${towerLevelCount(tower, shownLevels)} · ${toGo} to go</span>`;
    if (tower.active) state = '<span class="chip good">Activated</span>';

    let gold = '';
    if (tower.gold) gold = '<span class="chip warn">Gold</span>';
    return `<div>${state}${gold}</div>`;
}

export function showTowerPanel(context: PanelContext, towerIndex: number, how?: SelectHow): void {
    const progress = context.progress;
    context.remember(['tower', towerIndex]);
    markSelected(context, null);

    const tower = progress.towers[towerIndex];
    const shownNormal = tower.normal.filter((level) => !progress.hidden[level]);
    const todo = shownNormal.filter((level) => progress.state[level] !== 'solved');
    const done = shownNormal.filter((level) => progress.state[level] === 'solved');
    const dropdowns = tower.drop.filter((level) => !progress.hidden[level]);
    const unsolvedDropdowns = dropdowns.filter((level) => progress.state[level] !== 'solved');
    let html = panelHead(context, towerEmblemHtml(tower) + escapeHtml(towerName(tower.t)));
    html += towerStateHtml(tower, shownNormal.length, todo.length);

    let plan = null;
    if (!tower.active) plan = unlockPlan(progress, ['tower', towerIndex]);

    const steps = plan && stepsOf(context, plan);
    const chain = chainOf(context, plan, steps);
    const path = pathHtml(context, plan, false, steps);
    html += path + layerNote(context, chain, tower.p[2]);
    context.chainPoints = chain.points;

    // the levels the path names are not listed again
    const onPath = new Set<number>();
    if (path && plan && steps) {
        plan.nodes.forEach((node, key) => {
            if (node.t === 'l' && steps.num.has(key)) onPath.add(node.id);
        });
    }

    const offPath = todo.filter((level) => !onPath.has(level));
    let unsolvedTitle = 'Unsolved';
    if (offPath.length < todo.length) unsolvedTitle = 'Also unsolved';
    if (offPath.length) html += `<div class="h">${unsolvedTitle}</div><div>${pick(context, offPath)}</div>`;
    if (done.length) html += `<div class="h">Solved</div><div>${pick(context, done)}</div>`;
    if (dropdowns.length) {
        const solvedDropdowns = dropdowns.length - unsolvedDropdowns.length;
        html += `<div class="h">Dropdowns (optional) ${solvedDropdowns} / ${dropdowns.length}</div>`;
        html += `<div>${pick(context, dropdowns)}</div>`;
    }

    // lines from the tower to its unsolved levels: solid for required ones, dashed for dropdowns
    const links = uniqueLinks([
        ...todo.map((level): MapLink => [tower.p, level, 'req']),
        ...unsolvedDropdowns.map((level): MapLink => [tower.p, level, 'unl']),
        ...chain.links.filter(([, to]) => !(Array.isArray(to) && to === tower.p)),
    ]);
    const unsolved = [...todo, ...unsolvedDropdowns];
    let framed = unsolved;
    if (!unsolved.length) framed = [...shownNormal, ...dropdowns];

    context.map?.select(
        {
            levels: new Set([...shownNormal, ...dropdowns, ...chain.levels]),
            frontier: chain.frontier,
            overlays: chain.overlays,
            tower: towerIndex,
            exact: true,
            html,
            z: tower.p[2],
            points: [tower.p, ...pointsOf(context, framed), ...chain.points],
            links,
            steps: chain.steps,
        },
        how,
    );
}
