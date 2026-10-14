// The chips of the panels and the list (levels, ice gates, signs, towers, plan steps) and an unlock plan as panel text
// and as a chain on the map (VIEWER.md "The page (viewer)", "Unlock plans and next steps (viewer)",
// "The spoiler model (viewer)")
import { PROG } from '../data.js';
import { countBy, esc, prettyAch } from '../util.js';
import { layerName, mapLayerOf } from '../model/layers.js';
import { RANKS, STATES, stLabel } from '../model/progress.js';
import { SIGN_INDEX } from '../model/requirements.js';
import { towerName } from '../model/towers.js';
import { optionCount } from '../model/unlocking.js';
import { roleDot, ROLES, shapeIcon, starIcon, STATE_COLORS } from '../map/icons.js';

// level names may wrap after underscores
export const wrappable = (name) => esc(name).replace(/_/g, '_<wbr>');
export function stateDot(levelState) {
    if (levelState === 'solved') return starIcon(STATE_COLORS.solved);
    return shapeIcon('circle', STATE_COLORS[levelState]);
}
// a fogged level's chip carries only its index; revealing it draws the chip again with the name
const FOG_CHIP = 'Level under fog';
export const FOG_TEXT = '<span class="muted">A level under fog</span>';
export function levelChip(progress, i, attr = 'data-goto') {
    if (progress.hidden[i])
        return `<span class="chip spoiler" ${attr}="${i}" tabindex="0" role="button" title="Click to reveal">${FOG_CHIP}</span>`;
    const levelState = progress.state[i];
    return `<span class="chip ${STATES[levelState][1]}" ${attr}="${i}" tabindex="0" role="button" title="${esc(stLabel(progress, levelState))}">${wrappable(PROG.levels[i].n)}</span>`;
}

export function towerNameHtml(context, ti) {
    if (context.progress.towerHidden[ti]) return '<span class="muted">A tower under fog</span>';
    return esc(towerName(context.progress.towers[ti].t));
}
// what a sign asks for: a rank, a tower activated or a count of gold rooms visited
export function signNeed(context, sign) {
    if (sign.rank) {
        if (sign.rank === 255) return 'Any rank';
        return `Rank ${esc(RANKS[sign.rank] ?? sign.rank)} or higher`;
    }
    if (sign.tower != null && context.progress.towers[sign.tower])
        return towerNameHtml(context, sign.tower) + ' activated';
    if (sign.gold) return `${context.progress.goldFound} / ${sign.gold} gold rooms visited`;
    return 'Sign';
}
export function signText(context, sign) {
    let mark = '';
    if (context.progress.signOk(sign)) mark = '✓ ';
    return mark + signNeed(context, sign);
}
// how an ice gate with several options opens: with any of them or all of them
export function gateMode(freezer) {
    if (optionCount(freezer) <= 1) return '';
    if (freezer.or) return 'any of';
    return 'all of';
}
// a panel's role chip: the role of the thing for the goal, named with the goal
export function roleChipHtml(context, role) {
    if (!role || !context.goal) return '';
    return `<span class="chip">${roleDot(role)}${esc(ROLES[role][0])} for ${esc(context.goal.label)}</span>`;
}

export const pick = (context, ids) => ids.map((j) => levelChip(context.progress, j, 'data-pick')).join('');
// a sign that opens gates while it is shown
export const signOn = (context, si) => si != null && context.model.signSet.has(si);
// chips that open a panel: sign rules (when the sign is shown) and ice gates
export function signChip(context, sign) {
    const si = SIGN_INDEX.get(sign.pid);
    const opens = signOn(context, si) && !context.signs[si].status;
    let attributes = '';
    if (opens) attributes = ` data-psign="${si}" tabindex="0" role="button"`;
    return `<span class="chip${context.progress.signOk(sign) ? ' good' : ''}"${attributes}>${signText(context, sign)}</span>`;
}
// what opens an ice gate: its levels and sign rules
export function opensChips(context, freezer) {
    return pick(context, freezer.req) + (freezer.signs || []).map((sign) => signChip(context, sign)).join('');
}
export function gateChip(context, fi) {
    const open = context.progress.gateOpen[fi];
    return `<span class="chip${open ? ' good' : ''}" data-pgate="${fi}" tabindex="0" role="button" title="Gate at ${context.gateAt(fi)}">Ice gate${open ? ' (open)' : ''} · ${esc(context.gateName(fi))}</span>`;
}
// a gold room (plan step 'p') shows where the totals show it: once visited, or with spoilers shown
const roomPad = (context, ri) => context.teleporters[PROG.gold_rooms[ri].endpoint];
const roomShown = (context, ri) => context.model.rooms.includes(PROG.gold_rooms[ri]);
// the plan steps with no chip of their own: a gold room, the way onto a layer, a rank marker
function otherStepText(context, node) {
    if (node.t === 'p') return `Gold room · ${towerName(context.progress.towers[PROG.gold_rooms[node.id].tower].t)}`;
    if (node.t === 'a') return `The way onto the ${layerName(node.id)}`;
    return prettyAch(node.id);
}
function nodeChip(context, node) {
    if (node.t === 'l') return levelChip(context.progress, node.id, 'data-pick');
    if (node.t === 'g') return gateChip(context, node.id);
    if (node.t === 't')
        return `<span class="chip" data-ptower="${node.id}" tabindex="0" role="button">${esc(towerName(context.progress.towers[node.id].t))}</span>`;
    if (node.t === 's') return signChip(context, node.g);
    return `<span class="chip">${esc(otherStepText(context, node))}</span>`;
}

// a panel's header: Back while the panel history has a view to go back to, the title, Close
export function panelHead(context, title) {
    let back = '';
    if (context.back.length) back = '<button data-back title="Back" aria-label="Back">‹</button>';
    return `<div class="hd">${back}<b tabindex="-1">${title}</b><button data-close title="Close" aria-label="Close">×</button></div>`;
}
// the positions of the levels not under fog
export const pointsOf = (context, ids) =>
    ids.filter((j) => !context.progress.hidden[j]).map((j) => context.levels[j].p);
// the map's lines without repeats: [from, to, kind], an end being a level index or a position
export function uniqueLinks(links) {
    const seen = new Set();
    return links.filter(([from, to, kind]) => {
        const key = [from, to].map((end) => (Array.isArray(end) ? end.join(',') : end)).join('>') + kind;
        return !seen.has(key) && seen.add(key);
    });
}

// a plan's steps as the player sees them: levels, gates and towers under fog are left out and the numbers close up;
// a step's number is 1 + the highest number before it
export function stepsOf(context, plan) {
    const stepShown = context.model.stepShown;
    const before = new Map([...plan.nodes.keys()].map((key) => [key, []]));
    plan.edges.forEach(([from, to]) => before.get(to).push(from));
    const numbered = new Map();
    const numberOf = (key, stack = new Set()) => {
        if (numbered.has(key)) return numbered.get(key);
        if (stack.has(key)) return 0;
        stack.add(key);
        const highest = Math.max(0, ...before.get(key).map((earlier) => numberOf(earlier, stack)));
        stack.delete(key);
        let number = highest;
        if (key !== plan.rootKey && stepShown(plan.nodes.get(key))) number = highest + 1;
        numbered.set(key, number);
        return number;
    };
    const numbers = new Map();
    let fogged = 0;
    plan.nodes.forEach((node, key) => {
        if (key === plan.rootKey) return;
        if (stepShown(node)) numbers.set(key, numberOf(key));
        else fogged++;
    });
    return { num: numbers, fog: fogged };
}
// the unlock chain as panel text: what to solve first, then the steps in order
export function pathHtml(context, plan, always, steps) {
    if (!plan || plan.steps < 1) return '';
    const { num: numbers, fog: fogged } = steps;
    const rows = [];
    plan.nodes.forEach((node, key) => {
        if (numbers.has(key)) (rows[numbers.get(key) - 1] ||= []).push(node);
    });
    if (!rows.length || (!always && rows.length < 2)) return '';
    const line = (label, nodes, number) => {
        if (!nodes?.length) return '';
        return `<div class="pth"><span class="muted"><b class="stp">${number}</b>${label}</span> ${nodes.map((node) => nodeChip(context, node)).join('')}</div>`;
    };
    // a level or gate that opens with any one of several options shows the cheapest only
    const alternatives = [...plan.nodes]
        .filter(([key, node]) => numbers.has(key) && node.alt > 1)
        .map(
            ([, node]) =>
                `<div class="pth"><span class="muted">1 of ${node.alt} options for</span> ${nodeChip(context, node)}</div>`,
        )
        .join('');
    const first = rows[0];
    let html = `<div class="h">Path · ${numbers.size} step${numbers.size > 1 ? 's' : ''}</div>`;
    html += line(
        'Solve first',
        first.filter((node) => node.front),
        1,
    );
    html += line(
        'Not reachable yet',
        first.filter((node) => node.t === 'l' && !node.front),
        1,
    );
    html += line(
        'Needs',
        first.filter((node) => node.t !== 'l'),
        1,
    );
    html += rows
        .slice(1)
        .map((row, index) => line('then →', row, index + 2))
        .join('');
    html += alternatives;
    if (fogged) html += `<div class="muted">+${fogged} under fog</div>`;
    return html;
}
// steps on a layer other than the selection's get no marker: a row switches to them
export function layerNote(context, chain, z) {
    return [...chain.layers]
        .filter(([key]) => key !== mapLayerOf(z) && context.map.layers.includes(key))
        .map(
            ([key, count]) =>
                `<div class="muted"><button class="plain lnk" data-clayer="${key}">${count} step${count > 1 ? 's' : ''} on ${esc(layerName(key))}</button></div>`,
        )
        .join('');
}

// where a plan step sits on the map: a level by its index, the rest by position; null when it is not shown
function stepEnd(context, node) {
    if (node.t === 'l') return node.id;
    if (node.t === 'g') {
        const freezer = context.freezers[node.id];
        if (!context.gateShown(freezer)) return null;
        return freezer.p;
    }
    if (node.t === 's') {
        if (!signOn(context, node.id)) return null;
        return context.signs[node.id].p;
    }
    if (node.t === 'p') {
        if (!roomShown(context, node.id)) return null;
        return roomPad(context, node.id).p;
    }
    if (node.t !== 't') return null;
    if (context.progress.towerHidden[node.id]) return null;
    return context.progress.towers[node.id].p;
}
// the height of a plan step, for the layer it is on
function stepZ(context, node) {
    if (node.t === 'l') return context.levels[node.id].p[2];
    if (node.t === 'g') return context.freezers[node.id].p[2];
    if (node.t === 't') return context.progress.towers[node.id].p[2];
    if (node.t === 'p') return roomPad(context, node.id).p[2];
    if (node.t === 's' && node.id != null) return context.signs[node.id].p[2];
    return null;
}
// the chain on the map: its levels, the ones to solve first, its gates and signs, lines along its edges, points to frame
export function chainOf(context, plan, steps) {
    const chain = {
        levels: new Set(),
        frontier: new Set(),
        ov: new Set(),
        pts: [],
        links: [],
        steps: [],
        layers: new Map(),
    };
    if (!plan) return chain;
    const end = (key) => stepEnd(context, plan.nodes.get(key));
    plan.nodes.forEach((node) => {
        if (node.t === 'l') {
            chain.levels.add(node.id);
            if (node.front) chain.frontier.add(node.id);
        } else if (node.t === 'g' && context.gateShown(context.freezers[node.id])) chain.ov.add('g' + node.id);
        else if (node.t === 's' && signOn(context, node.id)) chain.ov.add('s' + node.id);
    });
    plan.nodes.forEach((node, key) => {
        const position = end(key);
        if (position == null) return;
        if (node.t !== 'l') chain.pts.push(position);
        else if (!context.progress.hidden[node.id]) chain.pts.push(context.levels[node.id].p);
    });
    plan.edges.forEach(([from, to]) => {
        const fromEnd = end(from),
            toEnd = end(to);
        if (fromEnd != null && toEnd != null) chain.links.push([fromEnd, toEnd, 'req']);
    });
    // the number is the step, 1 being solved first; the panel lists the same numbers
    const numbers = steps.num;
    const heights = [];
    plan.nodes.forEach((node, key) => {
        if (!numbers.has(key)) return;
        const position = end(key),
            z = stepZ(context, node);
        if (position != null) chain.steps.push([position, numbers.get(key)]);
        if (z != null) heights.push(z);
    });
    chain.layers = countBy(heights, mapLayerOf);
    return chain;
}
