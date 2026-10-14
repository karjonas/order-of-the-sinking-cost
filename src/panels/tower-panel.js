// A tower's panel on the map: activated or how many to go, the path to activate it, its unsolved, solved and dropdown
// levels (VIEWER.md "The page (viewer)")
import { esc } from '../util.js';
import { unlockPlan } from '../model/plans.js';
import { towerName } from '../model/towers.js';
import { markSelected } from './list.js';
import { chainOf, layerNote, panelHead, pathHtml, pick, pointsOf, stepsOf, uniqueLinks } from './plan-chips.js';

function towerStateHtml(tower) {
    let state = `<span class="chip">${tower.solvedNormal} / ${tower.req} · ${Math.max(0, tower.req - tower.solvedNormal)} to go</span>`;
    if (tower.active) state = '<span class="chip good">Activated</span>';
    let gold = '';
    if (tower.gold) gold = '<span class="chip warn">Gold</span>';
    return `<div>${state}${gold}</div>`;
}

export function showTowerPanel(context, ti, how) {
    const progress = context.progress;
    context.remember(['tower', ti]);
    markSelected(context, null);
    const tower = progress.towers[ti],
        todo = tower.normal.filter((j) => progress.state[j] !== 'solved'),
        done = tower.normal.filter((j) => progress.state[j] === 'solved'),
        dropdowns = tower.drop.filter((j) => !progress.hidden[j]);
    const unsolvedDropdowns = dropdowns.filter((j) => progress.state[j] !== 'solved');
    let html = panelHead(context, esc(towerName(tower.t)));
    html += towerStateHtml(tower);
    let plan = null;
    if (!tower.active) plan = unlockPlan(progress, ['tower', ti]);
    const steps = plan && stepsOf(context, plan),
        chain = chainOf(context, plan, steps);
    html += pathHtml(context, plan, false, steps) + layerNote(context, chain, tower.p[2]);
    context.chainPoints = chain.pts;
    if (todo.length) html += `<div class="h">Unsolved</div><div>${pick(context, todo)}</div>`;
    if (done.length) html += `<div class="h">Solved</div><div>${pick(context, done)}</div>`;
    if (dropdowns.length)
        html += `<div class="h">Dropdowns (optional) ${dropdowns.length - unsolvedDropdowns.length} / ${dropdowns.length}</div><div>${pick(context, dropdowns)}</div>`;
    // lines from the tower to its unsolved levels: solid for required ones, dashed for dropdowns
    const links = uniqueLinks([
        ...todo.map((j) => [tower.p, j, 'req']),
        ...unsolvedDropdowns.map((j) => [tower.p, j, 'unl']),
        ...chain.links.filter(([, to]) => !(Array.isArray(to) && to === tower.p)),
    ]);
    const unsolved = [...todo, ...unsolvedDropdowns];
    let framed = unsolved;
    if (!unsolved.length) framed = [...tower.normal, ...dropdowns];
    context.map.select(
        {
            levels: new Set([...tower.normal, ...dropdowns, ...chain.levels]),
            frontier: chain.frontier,
            ov: chain.ov,
            tower: ti,
            exact: true,
            html,
            z: tower.p[2],
            pts: [tower.p, ...pointsOf(context, framed), ...chain.pts],
            links,
            steps: chain.steps,
        },
        how,
    );
}
