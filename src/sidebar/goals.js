// The sidebar's goals ladder: a row per goal with its mark and count, the towers and achievements listed inline, and
// the picking of a goal for the list and the map (VIEWER.md "The page (viewer)", "Goals (viewer)")
import { $, esc } from '../util.js';
import { hooks } from '../shared.js';
import { bar } from '../format.js';
import { checkIcon } from '../map/icons.js';
import { show } from '../view.js';

// goals with children (the towers, the achievements) that are listed open
const goalsOpen = new Set();

// "23 left" for an ending (plan steps left), "3 / 16" for the rest; a trailing + says more is under fog
function goalCountText(goal) {
    const more = goal.fogged ? '+' : '';
    if (goal.kind === 'ending') {
        if (goal.done) return '';
        if (goal.left == null) return '—';
        if (goal.left === 0 && goal.fogged) return 'under fog';
        return `${goal.left}${more} left`;
    }
    const [got, total] = goal.progress;
    return `${got} / ${total}${more}`;
}
function goalTip(goal) {
    const parts = [goal.label];
    if (goal.kind === 'ending') {
        if (goal.done) parts.push('Earned');
        else if (goal.left != null) parts.push(`${goal.left}${goal.fogged ? '+' : ''} plan steps left`);
    } else {
        const [got, total] = goal.progress;
        parts.push(`${got} of ${total}${goal.fogged ? '+' : ''} ${goal.unit}`);
    }
    if (goal.fogged) parts.push('more is under fog');
    return parts.join(' · ');
}
function goalMark(goal) {
    if (goal.done) return `<span class="mk" title="Done">${checkIcon}</span>`;
    if (goal.active) return '<span class="mk now" title="Your current goal">◆</span>';
    return '<span class="mk"></span>';
}
function goalRowHtml(goal, selectedKey, isChild, open) {
    const classes = ['plain', 'gl'];
    if (isChild) classes.push('kid');
    if (goal.done) classes.push('done');
    const selected = goal.key === selectedKey;
    if (selected) classes.push('on');
    const expandable = !!goal.children?.length;
    let chevron = '';
    if (expandable) chevron = `<i class="chev" aria-hidden="true">${open ? '▾' : '▸'}</i>`;
    let progressBar = '';
    if (goal.kind !== 'ending' && !goal.done && goal.progress[1] > 0)
        progressBar = bar(goal.progress[0], goal.progress[1]);
    const expanded = expandable ? ` aria-expanded="${open}"` : '';
    return `<button class="${classes.join(' ')}" data-goal="${esc(goal.key)}" aria-pressed="${selected}"${expanded} title="${esc(goalTip(goal))}">${goalMark(goal)}<span class="n">${esc(goal.label)}</span><span class="cnt">${goalCountText(goal)}${chevron}</span>${progressBar}</button>`;
}
// what the row of a totals line says about the things not found yet
export function finderTip(model, kind) {
    const finder = model.finds[kind];
    if (finder.open.length) return 'Show the ones not found yet on the map';
    if (finder.fogged) return 'None left outside the fog';
    if (finder.off) return 'The rest are not on the map';
    return 'All found';
}
// the gold rooms found, under the first ending (a gold room count is part of its plan); framed on the map on a click.
// With spoilers hidden only the visited ones are known, so the row is a count of them.
function goldRowHtml(model) {
    const [found, total] = model.stats.gold;
    if (!total) return '';
    if (model.hide)
        return `<div class="gl sub" title="${esc(model.stats.by.gold)}"><span class="mk"></span><span class="n">Gold rooms visited</span><span class="cnt">${found}</span></div>`;
    const tip = [model.stats.by.gold, finderTip(model, 'gold')].filter(Boolean).join(' · ');
    return `<button class="plain gl sub" data-find="gold" aria-pressed="false" title="${esc(tip)}"><span class="mk"></span><span class="n">Gold rooms</span><span class="cnt">${found} / ${total}</span></button>`;
}
export function sideGoalsHtml(model) {
    const head = '<div class="sh">Goals</div>';
    if (!model.goals.length) return `${head}<div class="muted">Working out the goals…</div>`;
    const selected = model.goalFor(model.F.goal);
    const rows = model.goals.map((goal, index) => {
        const childSelected = goal.children?.some((child) => child.key === selected.key);
        const open = goalsOpen.has(goal.key) || !!childSelected;
        let html = goalRowHtml(goal, selected.key, false, open);
        if (open) {
            const kids = goal.children.map((child) => goalRowHtml(child, selected.key, true, false)).join('');
            let details = '';
            if (goal.kind === 'achievements')
                details =
                    '<button class="plain lnk" id="achBtn" title="Every achievement and what earns it">Details</button>';
            html += `<div class="kids">${kids}</div>${details}`;
        }
        if (index === 0) html += goldRowHtml(model);
        return html;
    });
    return head + rows.join('');
}
export function refreshSideGoals() {
    const element = $('#sideGoals');
    if (!element || !hooks.side) return;
    element.innerHTML = sideGoalsHtml(hooks.side);
}
// Picks a goal for the list and the map; a goal with children opens (or closes, when it was the pick) its list. A tower
// also adds its chip and is framed on the map. The active goal is stored as none, so the default follows progress.
export function pickGoal(model, key) {
    const goal = model.goalByKey(key);
    if (!goal) return;
    const filters = model.F;
    if (goal.children?.length) {
        if (model.goalFor(filters.goal).key === key && goalsOpen.has(key)) goalsOpen.delete(key);
        else goalsOpen.add(key);
    }
    const isActiveTopLevel = model.goals.some((each) => each === goal && each.active);
    filters.goal = isActiveTopLevel ? '' : key;
    filters.tower = goal.kind === 'tower' ? String(goal.tower) : '';
    if (hooks.apply) hooks.apply();
    else show();
    refreshSideGoals();
    $(`#sideGoals [data-goal="${key}"]`)?.focus({ preventScroll: true });
    if (goal.kind === 'tower') hooks.tower?.(goal.tower);
}
