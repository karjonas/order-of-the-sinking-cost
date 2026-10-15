// A tower's panel on the map: activated or how many to go, the path to activate it, its unsolved, solved and dropdown
// levels (VIEWER.md "The page (viewer)")
import { escapeHtml } from '../util.ts';
import type { MapLink, SelectHow } from '../map/map-view.ts';
import { unlockPlan } from '../model/plans.ts';
import { towerName } from '../model/towers.ts';
import type { TowerProgress } from '../model/towers.ts';
import type { PanelContext } from './context.ts';
import { markSelected } from './list.ts';
import { chainOf, layerNote, panelHead, pathHtml, pick, pointsOf, stepsOf, uniqueLinks } from './plan-chips.ts';

function towerStateHtml(tower: TowerProgress): string {
    const remaining = Math.max(0, tower.req - tower.solvedNormal);
    let state = `<span class="chip">${tower.solvedNormal} / ${tower.req} · ${remaining} to go</span>`;
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
    const todo = tower.normal.filter((level) => progress.state[level] !== 'solved');
    const done = tower.normal.filter((level) => progress.state[level] === 'solved');
    const dropdowns = tower.drop.filter((level) => !progress.hidden[level]);
    const unsolvedDropdowns = dropdowns.filter((level) => progress.state[level] !== 'solved');
    let html = panelHead(context, escapeHtml(towerName(tower.t)));
    html += towerStateHtml(tower);

    let plan = null;
    if (!tower.active) plan = unlockPlan(progress, ['tower', towerIndex]);

    const steps = plan && stepsOf(context, plan);
    const chain = chainOf(context, plan, steps);
    html += pathHtml(context, plan, false, steps) + layerNote(context, chain, tower.p[2]);
    context.chainPoints = chain.points;

    if (todo.length) html += `<div class="h">Unsolved</div><div>${pick(context, todo)}</div>`;
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
    if (!unsolved.length) framed = [...tower.normal, ...dropdowns];

    context.map?.select(
        {
            levels: new Set([...tower.normal, ...dropdowns, ...chain.levels]),
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
