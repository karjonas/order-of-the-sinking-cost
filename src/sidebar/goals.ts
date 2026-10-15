// The sidebar's goals ladder: a row per goal with its mark and count, the first ending's ground towers, the towers and
// the achievements listed inline, and the picking of a goal for the list and the map (VIEWER.md "The page (viewer)",
// "Goals (viewer)")
import { $, escapeHtml } from '../util.ts';
import { hooks } from '../shared.ts';
import { progressBarHtml } from '../format.ts';
import { checkIcon } from '../map/icons.ts';
import type { GoalView } from '../model/goals-view.ts';
import type { ProgressModel } from '../model/progress-model.ts';
import type { Finds } from '../model/totals.ts';
import { show } from '../view.ts';

// goals with children (the first ending, the towers, the achievements) that are listed open
const goalsOpen = new Set<string>();

// "23 left" for an ending (plan steps left), "1 / 4" for the first ending's Antipode teleporters visited, "teleporter"
// for a ground tower activated whose teleporter is not visited, "3 / 16" for the rest; a trailing + says more is under
// fog, except on the teleporters, whose total is the Sign's need
function goalCountText(goal: GoalView): string {
    let more = '';
    if (goal.fogged) more = '+';
    if (goal.kind === 'ending') {
        if (goal.done) return '';
        if (goal.progress) return `${goal.progress[0]} / ${goal.progress[1]}`;
        if (goal.left == null) return '—';
        if (goal.left === 0 && goal.fogged) return 'under fog';
        return `${goal.left}${more} left`;
    }

    if (goal.next) return 'teleporter';
    if (!goal.progress) return '';

    const [got, total] = goal.progress;
    return `${got} / ${total}${more}`;
}

function goalTip(goal: GoalView): string {
    let more = '';
    if (goal.fogged) more = '+';
    const parts = [goal.label];
    if (goal.kind === 'ending') {
        if (goal.done) parts.push('Earned');
        else if (goal.progress) parts.push(`${goal.progress[0]} of ${goal.progress[1]} Antipode teleporters visited`);
        else if (goal.left != null) parts.push(`${goal.left}${more} plan steps left`);
    } else if (goal.next) {
        parts.push('Activated', `Next: ${goal.next}`);
    } else if (goal.progress) {
        const [got, total] = goal.progress;
        parts.push(`${got} of ${total}${more} ${goal.unit}`);
    }

    if (goal.onPlan === false) parts.push('Not on the cheapest plan');
    if (goal.fogged) parts.push('more is under fog');
    return parts.join(' · ');
}

function goalMark(goal: GoalView): string {
    if (goal.done) return `<span class="mk" title="Done">${checkIcon}</span>`;
    if (goal.active) return '<span class="mk now" title="Your current goal">◆</span>';
    return '<span class="mk"></span>';
}

function goalRowHtml(goal: GoalView, selectedKey: string, isChild: boolean, open: boolean): string {
    const classes = ['plain', 'gl'];
    if (isChild) classes.push('kid');
    if (goal.done) classes.push('done');
    if (goal.onPlan === false) classes.push('off');

    const selected = goal.key === selectedKey;
    if (selected) classes.push('on');

    const expandable = !!goal.children?.length;
    let chevron = '';
    let expanded = '';
    if (expandable) {
        let mark = '▸';
        if (open) mark = '▾';
        chevron = `<i class="chev" aria-hidden="true">${mark}</i>`;
        expanded = ` aria-expanded="${open}"`;
    }

    let progressBar = '';
    if (goal.progress && !goal.done && goal.progress[1] > 0) {
        progressBar = progressBarHtml(goal.progress[0], goal.progress[1]);
    }

    const key = escapeHtml(goal.key);
    const tip = escapeHtml(goalTip(goal));
    const attributes = `data-goal="${key}" aria-pressed="${selected}"${expanded} title="${tip}"`;
    const label = `<span class="n">${escapeHtml(goal.label)}</span>`;
    const count = `<span class="cnt">${goalCountText(goal)}${chevron}</span>`;
    const content = goalMark(goal) + label + count + progressBar;
    return `<button class="${classes.join(' ')}" ${attributes}>${content}</button>`;
}

/** What the row of a totals line says about the things not found yet. */
export function finderTip(finder: Finds): string {
    if (finder.open.length) return 'Show the ones not found yet on the map';
    if (finder.fogged) return 'None left outside the fog';
    if (finder.off) return 'The rest are not on the map';
    return 'All found';
}

export function sideGoalsHtml(model: ProgressModel): string {
    const head = '<div class="sh">Goals</div>';
    if (!model.goals.length) return `${head}<div class="muted">Working out the goals…</div>`;

    const selected = model.goalFor(model.F.goal);
    if (!selected) return head;

    const rows = model.goals.map((goal) => {
        const childSelected = goal.children?.some((child) => child.key === selected.key);
        const open = goalsOpen.has(goal.key) || !!childSelected;
        let html = goalRowHtml(goal, selected.key, false, open);
        if (open) {
            const kids = (goal.children ?? []).map((child) => goalRowHtml(child, selected.key, true, false)).join('');
            let details = '';
            if (goal.kind === 'achievements') {
                const title = 'Every achievement and what earns it';
                details = `<button class="plain lnk" id="achBtn" title="${title}">Details</button>`;
            }

            html += `<div class="kids">${kids}</div>${details}`;
        }

        return html;
    });

    return head + rows.join('');
}

export function refreshSideGoals(): void {
    const element = $('#sideGoals');
    if (!element || !hooks.side) return;

    element.innerHTML = sideGoalsHtml(hooks.side);
}

/**
 * Picks a goal for the list and the map; a goal with children opens (or closes, when it was the pick) its list. A tower
 * (a ground tower under the first ending too) also adds its chip and is framed on the map. The active goal is stored as
 * none, so the default follows progress.
 */
export function pickGoal(model: ProgressModel, key: string): void {
    const goal = model.goalByKey(key);
    if (!goal) return;

    const filters = model.F;
    if (goal.children?.length) {
        if (model.goalFor(filters.goal)?.key === key && goalsOpen.has(key)) goalsOpen.delete(key);
        else goalsOpen.add(key);
    }

    const isActiveTopLevel = model.goals.some((each) => each === goal && each.active);
    if (isActiveTopLevel) filters.goal = '';
    else filters.goal = key;

    const towerIndex = goal.tower;
    if (towerIndex != null) filters.tower = String(towerIndex);
    else filters.tower = '';

    if (hooks.apply) hooks.apply();
    else show();

    refreshSideGoals();
    $(`#sideGoals [data-goal="${key}"]`)?.focus({ preventScroll: true });
    if (towerIndex != null) hooks.tower?.(towerIndex);
}
