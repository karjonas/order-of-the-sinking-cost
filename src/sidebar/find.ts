// The sidebar's Find on the map: a row per kind of mark, its icon showing or hiding the kind on the map and its name
// listing the items in the results column (VIEWER.md "The page (viewer)")
import { escapeHtml } from '../util.ts';
import { hooks } from '../shared.ts';
import type { ProgressFilters } from '../shared.ts';
import { findSectionOpen } from './sections.ts';
import { CHEVRON, checkIcon, OVERLAY_ICONS } from '../map/icons.ts';
import { overlayOn } from '../map/map-html.ts';
import { findLabel, FIND_KINDS } from '../model/find-kinds.ts';
import type { FindKind } from '../model/find-kinds.ts';
import type { ProgressModel } from '../model/progress-model.ts';
import type { FoundOfTotal } from '../model/totals.ts';

/** Whether the results column shows a kind's list: an open panel covers it. */
export function findListShown(filters: ProgressFilters, kind: string): boolean {
    if (filters.find !== kind) return false;
    if (hooks.panelOpen) return !hooks.panelOpen();
    return true;
}

/** What a kind's icon button does: it names the kind, as "Hide signs on the map". */
export function overlayActionText(kind: FindKind, shown: boolean): string {
    const name = findLabel(kind).toLowerCase();
    if (shown) return `Hide ${name} on the map`;
    return `Show ${name} on the map`;
}

// a row: the icon button shows or hides the kind on the map, the name button lists its items beside found / total
function findRowHtml(
    kind: FindKind,
    label: string,
    [found, total]: FoundOfTotal,
    byLayer: string,
    listed: boolean,
    note = '',
): string {
    const done = total > 0 && found >= total;
    let className = 'sr';
    if (done) className += ' done';

    const shown = overlayOn[kind];
    if (shown) className += ' on';

    let iconClass = 'plain si';
    if (shown) iconClass += ' on';

    const action = overlayActionText(kind, shown);
    const iconAttributes = `data-overlay="${kind}" aria-pressed="${shown}" aria-label="${action}" title="${action}"`;
    const iconButton = `<button class="${iconClass}" ${iconAttributes}>${OVERLAY_ICONS[kind]}</button>`;

    let check = '';
    if (done) check = checkIcon;
    const count = `<span class="cnt">${check}${found} / ${total}${note}</span>`;
    const title = escapeHtml([byLayer, 'List them'].filter(Boolean).join(' · '));
    const nameAttributes = `data-find="${kind}" aria-pressed="${listed}" title="${title}"`;
    const nameButton = `<button class="plain sn" ${nameAttributes}><span class="n">${label}</span>${count}</button>`;
    return `<div class="${className}">${iconButton}${nameButton}</div>`;
}

export function sideFindHtml(model: ProgressModel): string {
    const stats = model.stats;
    const rows: string[] = [];

    for (const [kind, label] of FIND_KINDS) {
        if (stats[kind][1] <= 0) continue;

        let note = '';
        if (kind === 'signs' && stats.signsReady > 0) note = ` · ${stats.signsReady} to read`;
        rows.push(findRowHtml(kind, label, stats[kind], stats.by[kind], findListShown(model.F, kind), note));
    }

    if (!rows.length) return '';

    const headContent = `<span class="sh">Find on the map</span>${CHEVRON}`;
    const open = findSectionOpen();
    const head = `<button class="plain fold" data-fold="find" aria-expanded="${open}">${headContent}</button>`;
    if (!open) return head;
    return head + rows.join('');
}
