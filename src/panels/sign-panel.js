// A sign's panel on the map: satisfied or not, what it needs, its tower, the path to satisfy it and the gates it opens
// (VIEWER.md "The page (viewer)")
import { esc } from '../util.js';
import { unlockPlan } from '../model/plans.js';
import { towerName } from '../model/towers.js';
import { markSelected } from './list.js';
import { chainOf, gateChip, layerNote, panelHead, pathHtml, signNeed, stepsOf } from './plan-chips.js';

function opensHtml(context, sign, gateIds) {
    if (!gateIds.length) return '';
    let html = `<div class="h">Opens</div><div>${gateIds.map((fi) => gateChip(context, fi)).join('')}</div>`;
    if (gateIds.length < sign.gates.length) html += '<div class="muted">and more under fog</div>';
    return html;
}

export function showSignPanel(context, si, how) {
    const progress = context.progress;
    context.remember(['sign', si]);
    markSelected(context, null);
    const sign = context.signs[si],
        satisfied = progress.signOk(sign),
        gateIds = sign.gates.filter((fi) => context.gateShown(context.freezers[fi]));
    const towerShown = sign.tower != null && progress.towers[sign.tower] && !progress.towerHidden[sign.tower];
    let html = panelHead(context, 'Sign');
    html += `<div><span class="chip${satisfied ? ' good' : ''}">${satisfied ? 'Satisfied' : 'Not yet'}</span></div><div class="h">Needs</div><div>${signNeed(context, sign)}</div>`;
    if (towerShown)
        html += `<div><span class="chip" data-ptower="${sign.tower}" tabindex="0" role="button">${esc(towerName(progress.towers[sign.tower].t))}</span></div>`;
    let plan = null;
    if (towerShown && !satisfied) plan = unlockPlan(progress, ['sign', si]);
    const steps = plan && stepsOf(context, plan),
        chain = chainOf(context, plan, steps);
    html += pathHtml(context, plan, false, steps) + layerNote(context, chain, sign.p[2]);
    context.chainPoints = chain.pts;
    html += opensHtml(context, sign, gateIds);
    context.map.select(
        {
            levels: chain.levels,
            frontier: chain.frontier,
            ov: new Set(['s' + si, ...gateIds.map((fi) => 'g' + fi), ...chain.ov]),
            html,
            z: sign.p[2],
            pts: [sign.p, ...gateIds.map((fi) => context.freezers[fi].p), ...chain.pts],
            links: [...gateIds.map((fi) => [sign.p, context.freezers[fi].p, 'req']), ...chain.links],
            steps: chain.steps,
        },
        how,
    );
}
