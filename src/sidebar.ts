// The sidebar: the campaign, No spoilers and the search, the goals, the totals to find on the map, the areas and the
// save's stats (VIEWER.md "The page (viewer)")
import { PROG } from './data.ts';
import { $, apolloDate, apolloSeconds, duration, escapeHtml, setButtonPressed } from './util.ts';
import { hooks, isFindKind, revealedOf, setPreference, setSpoilersHidden, spoilersHidden, state } from './shared.ts';
import type { ProgressFilters } from './shared.ts';
import { baseName, campaignOf, campaigns, campaignLabel, realFiles, statusEntry } from './files.ts';
import { capitalized, modelNoun } from './model/freezer-names.ts';
import { RANKS } from './model/progress.ts';
import type { ProgressModel } from './model/progress-model.ts';
import type { FoundOfTotal } from './model/totals.ts';
import { checkIcon, eyeIcon, STATE_ICONS } from './map/icons.ts';
import type { DemoStatus, Status } from './status-file.ts';
import { show } from './view.ts';
import { dirHandle, dropsLive, pickFolder, refresh, timeAgo } from './folder.ts';
import { achievementsHtml, inLevelHtml, statsHtml } from './sidebar/summary.ts';
import { finderTip, pickGoal, sideGoalsHtml } from './sidebar/goals.ts';
import { areaListOpen, sideAreasHtml, toggleAreaList, toggleFinished, toggleLayerGroup } from './sidebar/areas.ts';

/** The totals the sidebar counts: found and total per kind. */
type TotalKind = 'pods' | 'doorways' | 'signs' | 'tps' | 'logs';

/**
 * A fogged level the viewer clicked open stays shown for the rest of the visit; everything naming it is drawn again.
 */
export function revealLevel(level: number): void {
    if (state.camp !== null) revealedOf(state.camp).add(level);

    const model = hooks.side;
    if (!model || !model.progress.hidden[level]) return;

    model.progress.hidden[level] = false;
    hooks.reveal?.();
    renderSide(model);

    const dialog = $('#achDlg');
    if (dialog instanceof HTMLDialogElement && dialog.open) $('#achBody').innerHTML = achievementsHtml(model);
}

const OPEN_OTHER = '\u0001open';

// the parse errors and warnings of the campaign's files
function fileErrorsHtml(): string {
    return [...state.files.values()]
        .filter((file) => (file.error || file.warning) && campaignOf(file.path) === state.camp)
        .map((file) => {
            let className = 'fwarn';
            if (file.error) className = 'err';
            const message = escapeHtml(file.error || file.warning);
            return `<div class="${className}">${escapeHtml(baseName(file.path))}: ${message}</div>`;
        })
        .join('');
}

// whether a status is a saved one, which tells when it was written; the example's is not
const isSavedStatus = (status: Status | DemoStatus): status is Status => status.savedLo !== undefined;

// rank, play time and when the save was last written
function saveMetaHtml(status: Status): string {
    const saved = apolloDate(status.savedLo, status.savedHi);
    const savedTime = saved.getTime();
    const rank = escapeHtml(RANKS[status.rank] ?? status.rank);
    const playTime = duration(apolloSeconds(status.playLo, status.playHi));
    const savedTitle = escapeHtml(saved.toLocaleString());

    const rankHtml = `<span title="Rank">${rank}</span>`;
    const playTimeHtml = `<span title="Play time">${playTime}</span>`;
    const savedAttributes = `id="savedAgo" data-t="${savedTime}" title="Saved ${savedTitle}"`;
    const savedHtml = `<span ${savedAttributes}>${timeAgo(savedTime)}</span>`;
    return `<div class="muted meta">${rankHtml} · ${playTimeHtml} · ${savedHtml}</div>`;
}

// the campaign block: the example's note, or the campaign list with the refresh button and the save's summary
function campaignHtml(model: ProgressModel | null | undefined, campaignList: string[]): string {
    const entry = state.camp === null ? undefined : statusEntry(state.camp);
    const status = entry?.parsed;
    const errors = fileErrorsHtml();

    // with saves open the campaign list takes the open button's place; its last entry opens another folder
    const opened = realFiles().length > 0;
    if (!opened) {
        const note = '<div class="muted meta">Example: a new game</div>';
        return `<div class="camp empty">${note}${inLevelHtml()}</div>${errors}`;
    }

    // a connected folder gets the refresh button, its dot showing the folder is watched
    let live = '';
    if (dirHandle) {
        const folderName = escapeHtml(dirHandle.name);
        const watched = '(it is re-read every few seconds while this page is visible)';
        const title = `Re-read the save folder “${folderName}” ${watched}`;
        const attributes = `id="refreshBtn" class="live" title="${title}" aria-label="Re-read the save folder"`;
        live = `<button ${attributes}><span class="dot"></span>↻</button>`;
    }

    // saves read once say so, and how to make them live
    let snapshot = '';
    if (!dirHandle) {
        let howToKeepLive = '';
        if (dropsLive) howToKeepLive = ' · drop the folder here to keep it live';

        const title = 'These files were read once; new progress shows after the folder is opened again';
        snapshot = `<div class="muted meta snap" title="${title}">Snapshot${howToKeepLive}</div>`;
    }

    const options = campaignList
        .map((camp) => {
            let selected = '';
            if (camp === state.camp) selected = ' selected';
            return `<option value="${escapeHtml(camp)}"${selected}>${escapeHtml(campaignLabel(camp))}</option>`;
        })
        .join('');

    let meta = '';
    if (status && isSavedStatus(status) && !entry?.demo) meta = saveMetaHtml(status);

    const openOtherOption = `<option value="${OPEN_OTHER}">Open another folder…</option>`;
    const openOther = `<optgroup label="──────────">${openOtherOption}</optgroup>`;
    const select = `<select id="campSel" aria-label="Campaign">${options}${openOther}</select>`;
    const inLevel = inLevelHtml(status, model);
    return `<div class="camp"><div class="cr">${select}${live}</div>${meta}${snapshot}${inLevel}</div>${errors}`;
}

// a totals row: its icon, label and found / total; a button when it frames the ones not found yet on the map
function totalsRowHtml(
    icon: string,
    label: string,
    [found, total]: FoundOfTotal,
    tag = 'div',
    tip = '',
    attributes = '',
): string {
    const done = total > 0 && found >= total;
    let titleAttribute = '';
    if (tip) titleAttribute = ` title="${escapeHtml(tip)}"`;

    let className = 'sr';
    if (tag === 'button') className = 'plain ' + className;
    if (done) className += ' done';

    let check = '';
    if (done) check = checkIcon;
    const count = `<span class="cnt">${check}${found} / ${total}</span>`;
    return `<${tag}${attributes}${titleAttribute} class="${className}">${icon}<span>${label}</span>${count}</${tag}>`;
}

const FINDERS: Array<[kind: TotalKind, label: string]> = [
    ['pods', capitalized(modelNoun(false))],
    ['doorways', capitalized(modelNoun(true))],
    ['signs', 'Signs'],
    ['tps', 'Teleporters'],
    ['logs', 'Voice logs'],
];

function findOnMapHtml(model: ProgressModel): string {
    const stats = model.stats;
    const rows: string[] = [];

    for (const [kind, label] of FINDERS) {
        if (stats[kind][1] <= 0) continue;

        if (!isFindKind(kind)) {
            rows.push(totalsRowHtml(STATE_ICONS[kind], label, stats[kind], 'div', stats.by[kind]));
            continue;
        }

        const tip = [stats.by[kind], finderTip(model.finds[kind])].filter(Boolean).join(' · ');
        rows.push(
            totalsRowHtml(
                STATE_ICONS[kind],
                label,
                stats[kind],
                'button',
                tip,
                ` data-find="${kind}" aria-pressed="false"`,
            ),
        );
    }

    // treasures are picked up inside a level, so their row only counts the plinths that show one
    if (stats.treasures[1] > 0) {
        rows.push(totalsRowHtml(STATE_ICONS.treasures, 'Treasures', stats.treasures, 'div', stats.by.treasures));
    }

    if (!rows.length) return '';
    return `<div class="np stats"><div class="sh">Find on the map</div>${rows.join('')}</div>`;
}

// the panels under the campaign: No spoilers and the search, the goals, the totals, the areas and the stats
function panelsHtml(model: ProgressModel): string {
    const spoilTitle =
        'On: levels, areas, towers and achievements still under fog are left out. Off: everything is shown';
    const spoilButton = `<button class="spoil" id="pgSpoil" title="${spoilTitle}">${eyeIcon}No spoilers</button>`;
    let html = `<div class="np">${spoilButton}`;
    if (model.noFog) {
        let fogNote = 'This build has no fog data';
        if (PROG.fog) fogNote = 'Fog needs overworld.history';
        let onlyEntered = '';
        if (model.hide) onlyEntered = '; only entered levels are shown';
        html += `<div class="muted">${fogNote}${onlyEntered}</div>`;
    }

    const searchInput = '<input type="search" id="fQ" placeholder="Search levels…" aria-label="Search levels">';
    html += `<div class="fl">${searchInput}</div></div>`;
    html += `<div class="np goals" id="sideGoals">${sideGoalsHtml(model)}</div>`;
    html += findOnMapHtml(model);

    let areasOpenClass = '';
    if (areaListOpen()) areasOpenClass = ' open';
    html += `<div class="np alist${areasOpenClass}" id="sideAreas">${sideAreasHtml(model)}</div>`;

    if (!model.demo) html += statsHtml(model);
    return html;
}

function onCampaignPicked(event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;

    if (select.value === OPEN_OTHER) {
        select.value = state.camp ?? '';
        void pickFolder();
        return;
    }

    state.camp = select.value;
    state.campPicked = true;
    show();
}

function onStatsToggle(event: Event): void {
    const button = event.currentTarget;
    if (!(button instanceof HTMLElement)) return;

    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));

    const chevron = button.querySelector('.chev');
    if (chevron) chevron.textContent = open ? '▾' : '▴';
    $('#statsRows').hidden = !open;
    $('#sideStats').classList.toggle('open', open);
    setPreference('statsOpen', open ? '1' : '0');
}

function onGoalsClick(event: Event, model: ProgressModel): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const find = target.closest<HTMLElement>('[data-find]');
    if (find) {
        const kind = find.dataset.find;
        if (kind !== undefined && isFindKind(kind)) hooks.find?.(kind);
        return;
    }

    if (target.closest('#achBtn')) {
        $('#achBody').innerHTML = achievementsHtml(model);

        const dialog = $('#achDlg');
        if (dialog instanceof HTMLDialogElement) dialog.showModal();
        return;
    }

    const goalKey = target.closest<HTMLElement>('[data-goal]')?.dataset.goal;
    if (goalKey !== undefined) pickGoal(model, goalKey);
}

function onAreasClick(event: Event, filters: ProgressFilters, changed: () => void): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-areas]')) {
        toggleAreaList();
        refreshSideAreas();
        $('#sideAreas [data-areas]')?.focus({ preventScroll: true });
        return;
    }

    const group = target.closest<HTMLElement>('[data-grp]');
    if (group) {
        const groupKey = group.dataset.grp ?? '';
        toggleLayerGroup(groupKey);
        refreshSideAreas();
        $(`#sideAreas [data-grp="${groupKey}"]`)?.focus({ preventScroll: true });
        return;
    }

    const finished = target.closest<HTMLElement>('[data-fin]');
    if (finished) {
        toggleFinished();
        refreshSideAreas();
        $(`#sideAreas [data-fin="${finished.dataset.fin}"]`)?.focus({ preventScroll: true });
        return;
    }

    const area = target.closest<HTMLElement>('[data-area]');
    if (!area) return;

    const picked = area.dataset.area ?? '';
    if (filters.area === picked) filters.area = '';
    else filters.area = picked;
    changed();
    if (filters.area !== '') hooks.area?.();
}

// the search box applies its text once typing pauses
let searchTimer = 0;

export function renderSide(model?: ProgressModel | null): void {
    const side = $('#sidePanels');
    const campaignList = campaigns();
    if (!campaignList.length) {
        side.innerHTML = '';
        $('#sideCamp').innerHTML = '';
        $('#sidebar .btns').style.display = '';
        return;
    }

    // the example view has the banner's own open button
    $('#sidebar .btns').style.display = 'none';
    $('#sideCamp').innerHTML = campaignHtml(model, campaignList);

    let html = '';
    if (model) html = panelsHtml(model);
    side.innerHTML = html;

    $('#campSel')?.addEventListener('change', onCampaignPicked);
    $('#refreshBtn')?.addEventListener('click', () => void refresh(true));
    if (!model) return;

    const inLevel = model.inLevel;
    $('#inLevel')?.addEventListener('click', () => {
        if (inLevel !== null) hooks.open?.(inLevel);
    });

    const filters = model.F;
    const changed = (): void => {
        if (hooks.apply) hooks.apply();
        else show();
    };

    $('#fQ').addEventListener('input', (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement)) return;

        const query = input.value.toLowerCase().trim();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            filters.q = query;
            changed();
        }, 120);
    });

    hooks.side = model;
    setButtonPressed($('#pgSpoil'), model.hide);
    $('#pgSpoil').addEventListener('click', () => {
        setSpoilersHidden(!spoilersHidden);
        setPreference('hideSpoilers', spoilersHidden ? '1' : '0');
        show();
    });

    $('#statsTog')?.addEventListener('click', onStatsToggle);
    $('#sideGoals').addEventListener('click', (event) => onGoalsClick(event, model));
    $('.side .stats')?.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const kind = target.closest<HTMLElement>('[data-find]')?.dataset.find;
        if (kind !== undefined && isFindKind(kind)) hooks.find?.(kind);
    });

    $('#sideAreas')?.addEventListener('click', (event) => onAreasClick(event, filters, changed));
    syncSide(filters);
}

export function refreshSideAreas(): void {
    const element = $('#sideAreas');
    if (!element || !hooks.side) return;

    element.innerHTML = sideAreasHtml(hooks.side);
    element.classList.toggle('open', areaListOpen());
    syncSide(hooks.side.F);
}

/** The sidebar's controls show the filters: the search text, the totals row framed on the map and the picked area. */
export function syncSide(filters: ProgressFilters): void {
    const search = $('#fQ');
    if (!search) return;

    if (document.activeElement !== search && search instanceof HTMLInputElement) search.value = filters.q;
    $('#sidebar')
        .querySelectorAll<HTMLElement>('[data-find]')
        .forEach((button) => setButtonPressed(button, button.dataset.find === filters.find));
    $('#sideAreas')
        ?.querySelectorAll<HTMLElement>('[data-area]')
        .forEach((area) => setButtonPressed(area, area.dataset.area === filters.area));
}
