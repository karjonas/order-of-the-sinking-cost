// An ice gate's panel on the map: open or closed and its role, what opens it, the levels it leads to and the path to
// open it (VIEWER.md "The page (viewer)")
import { esc } from '../util.js';
import { roleFor } from '../model/goal-roles.js';
import { unlockPlan } from '../model/plans.js';
import { SIGN_INDEX } from '../model/requirements.js';
import { markSelected } from './list.js';
import {
    chainOf,
    gateMode,
    layerNote,
    opensChips,
    panelHead,
    pathHtml,
    pick,
    pointsOf,
    roleChipHtml,
    signOn,
    stepsOf,
    uniqueLinks,
} from './plan-chips.js';

function leadsToHtml(context, leadsAll, leads) {
    if (!leadsAll.length) return '';
    let html = '<div class="h">Leads to</div>';
    if (leads.length) html += `<div>${pick(context, leads)}</div>`;
    if (leads.length < leadsAll.length) html += '<div class="muted">and more under fog</div>';
    return html;
}

export function showGatePanel(context, fi, how) {
    const progress = context.progress;
    context.remember(['gate', fi]);
    markSelected(context, null);
    const freezer = context.freezers[fi],
        isOpen = progress.gateOpen[fi],
        mode = gateMode(freezer),
        signs = freezer.signs || [];
    const area = context.gateArea(fi);
    let html = panelHead(context, 'Ice gate');
    html += `<div><span class="chip${isOpen ? ' good' : ''}">${isOpen ? 'Open' : 'Closed'}</span>${roleChipHtml(context, roleFor(context.goal, 'g', fi))}</div><div class="muted">${area != null ? `${esc(area)} · ` : ''}Gate at ${context.gateAt(fi)}</div>`;
    html += `<div class="h">Opens with${mode ? ' ' + mode : ''}</div><div>${opensChips(context, freezer)}</div>`;
    let leadsAll = [];
    if (!isOpen) leadsAll = progress.reach?.leads.get(fi) || [];
    const leads = leadsAll.filter((j) => !progress.hidden[j]);
    html += leadsToHtml(context, leadsAll, leads);
    let plan = null;
    if (!isOpen) plan = unlockPlan(progress, ['gate', fi]);
    const steps = plan && stepsOf(context, plan),
        chain = chainOf(context, plan, steps);
    html += pathHtml(context, plan, false, steps) + layerNote(context, chain, freezer.p[2]);
    context.chainPoints = chain.pts;
    const signsShown = signs.map((sign) => SIGN_INDEX.get(sign.pid)).filter((si) => signOn(context, si));
    const links = uniqueLinks([
        ...freezer.req.map((j) => [j, freezer.p, 'req']),
        ...signsShown.map((si) => [context.signs[si].p, freezer.p, 'req']),
        ...leads.map((j) => [freezer.p, j, 'unl']),
        ...chain.links,
    ]);
    context.map.select(
        {
            levels: new Set([...freezer.req, ...leads, ...chain.levels]),
            frontier: chain.frontier,
            ov: new Set(['g' + fi, ...signsShown.map((si) => 's' + si), ...chain.ov]),
            html,
            z: freezer.p[2],
            pts: [
                freezer.p,
                ...pointsOf(context, [...freezer.req, ...leads]),
                ...signsShown.map((si) => context.signs[si].p),
                ...chain.pts,
            ],
            links,
            steps: chain.steps,
        },
        how,
    );
}
