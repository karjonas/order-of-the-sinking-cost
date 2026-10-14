// The sidebar: the campaign, No spoilers and the search, the goals, the totals to find on the map, the areas and the
// save's stats (VIEWER.md "The page (viewer)")
import { PROG } from './data.js';
import { $, apolloDate, apolloSeconds, dur, esc, segOn } from './util.js';
import { hooks, revealedOf, setPref, setSpoilersHidden, spoilersHidden, state } from './shared.js';
import { baseName, campaignOf, campaigns, campLabel, realFiles, statusEntry } from './files.js';
import { RANKS } from './model/progress.js';
import { checkIcon, eyeIcon, ST_ICONS } from './map/icons.js';
import { show } from './view.js';
import { dirHandle, dropsLive, pickFolder, refresh, timeAgo } from './folder.js';
import { achievementsHtml, inLevelHtml, statsHtml } from './sidebar/summary.js';
import { finderTip, pickGoal, sideGoalsHtml } from './sidebar/goals.js';
import { areaListOpen, sideAreasHtml, toggleAreaList, toggleFinished, toggleLayerGroup } from './sidebar/areas.js';

// a fogged level the viewer clicked open stays shown for the rest of the visit; everything naming it is drawn again
export function revealLevel(i) {
    revealedOf(state.camp).add(i);
    const model = hooks.side;
    if (!model || !model.progress.hidden[i]) return;
    model.progress.hidden[i] = false;
    hooks.reveal?.();
    renderSide(model);
    if ($('#achDlg').open) $('#achBody').innerHTML = achievementsHtml(model);
}
const OPEN_OTHER = '\u0001open';

// the parse errors and warnings of the campaign's files
function fileErrorsHtml() {
    return [...state.files.values()]
        .filter((file) => (file.error || file.warning) && campaignOf(file.path) === state.camp)
        .map(
            (file) =>
                `<div class="${file.error ? 'err' : 'fwarn'}">${esc(baseName(file.path))}: ${esc(file.error || file.warning)}</div>`,
        )
        .join('');
}
// rank, play time and when the save was last written
function saveMetaHtml(status) {
    const saved = apolloDate(status.savedLo, status.savedHi);
    return `<div class="muted meta"><span title="Rank">${esc(RANKS[status.rank] ?? status.rank)}</span> · <span title="Play time">${dur(apolloSeconds(status.playLo, status.playHi))}</span> · <span id="savedAgo" data-t="${saved.getTime()}" title="Saved ${esc(saved.toLocaleString())}">${timeAgo(saved.getTime())}</span></div>`;
}
// the campaign block: the example's note, or the campaign list with the refresh button and the save's summary
function campaignHtml(model, campaignList) {
    const status = statusEntry(state.camp)?.parsed;
    const errors = fileErrorsHtml();
    // with saves open the campaign list takes the open button's place; its last entry opens another folder
    const opened = realFiles().length > 0;
    if (!opened)
        return `<div class="camp empty"><div class="muted meta">Example: a new game</div>${inLevelHtml()}</div>${errors}`;
    // a connected folder gets the refresh button, its dot showing the folder is watched
    let live = '';
    if (dirHandle)
        live = `<button id="refreshBtn" class="live" title="Re-read the save folder “${esc(dirHandle.name)}” (it is re-read every few seconds while this page is visible)" aria-label="Re-read the save folder"><span class="dot"></span>↻</button>`;
    // saves read once say so, and how to make them live
    let snapshot = '';
    if (!dirHandle)
        snapshot = `<div class="muted meta snap" title="These files were read once; new progress shows after the folder is opened again">Snapshot${dropsLive ? ' · drop the folder here to keep it live' : ''}</div>`;
    const options = campaignList
        .map(
            (camp) =>
                `<option value="${esc(camp)}"${camp === state.camp ? ' selected' : ''}>${esc(campLabel(camp))}</option>`,
        )
        .join('');
    let meta = '';
    if (status && !statusEntry(state.camp)?.demo) meta = saveMetaHtml(status);
    return `<div class="camp"><div class="cr"><select id="campSel" aria-label="Campaign">${options}<optgroup label="──────────"><option value="${OPEN_OTHER}">Open another folder…</option></optgroup></select>${live}</div>${meta}${snapshot}${inLevelHtml(status, model)}</div>${errors}`;
}
// a totals row: its icon, label and found / total; a button when it frames the ones not found yet on the map
function totalsRowHtml(icon, label, [found, total], tag = 'div', tip = '', attributes = '') {
    const done = total > 0 && found >= total;
    return `<${tag}${attributes}${tip ? ` title="${esc(tip)}"` : ''} class="${tag === 'button' ? 'plain ' : ''}sr${done ? ' done' : ''}">${icon}<span>${label}</span><span class="cnt">${done ? checkIcon : ''}${found} / ${total}</span></${tag}>`;
}
const FINDERS = [
    ['gates', 'Ice gates'],
    ['tps', 'Teleporters'],
    ['logs', 'Voice logs'],
];
function findOnMapHtml(model) {
    const stats = model.stats;
    const rows = FINDERS.filter(([kind]) => stats[kind][1] > 0).map(([kind, label]) => {
        if (!model.finds[kind]) return totalsRowHtml(ST_ICONS[kind], label, stats[kind], 'div', stats.by[kind]);
        const tip = [stats.by[kind], finderTip(model, kind)].filter(Boolean).join(' · ');
        return totalsRowHtml(
            ST_ICONS[kind],
            label,
            stats[kind],
            'button',
            tip,
            ` data-find="${kind}" aria-pressed="false"`,
        );
    });
    // treasures are picked up inside a level, so their row only counts the plinths that show one
    if (stats.treasures[1] > 0)
        rows.push(totalsRowHtml(ST_ICONS.treasures, 'Treasures', stats.treasures, 'div', stats.by.treasures));
    if (!rows.length) return '';
    return `<div class="np stats"><div class="sh">Find on the map</div>${rows.join('')}</div>`;
}
// the panels under the campaign: No spoilers and the search, the goals, the totals, the areas and the stats
function panelsHtml(model) {
    let html = `<div class="np"><button class="spoil" id="pgSpoil" title="On: levels, areas, towers and achievements still under fog are left out. Off: everything is shown">${eyeIcon}No spoilers</button>`;
    if (model.noFog)
        html += `<div class="muted">${PROG.fog ? 'Fog needs overworld.history' : 'This build has no fog data'}${model.hide ? '; only entered levels are shown' : ''}</div>`;
    html += `<div class="fl"><input type="search" id="fQ" placeholder="Search levels…" aria-label="Search levels"></div></div>`;
    html += `<div class="np goals" id="sideGoals">${sideGoalsHtml(model)}</div>`;
    html += findOnMapHtml(model);
    html += `<div class="np alist${areaListOpen() ? ' open' : ''}" id="sideAreas">${sideAreasHtml(model)}</div>`;
    if (!model.demo) html += statsHtml(model);
    return html;
}

function onCampaignPicked(event) {
    if (event.target.value === OPEN_OTHER) {
        event.target.value = state.camp;
        pickFolder();
        return;
    }
    state.camp = event.target.value;
    state.campPicked = true;
    show();
}
function onStatsToggle(event) {
    const button = event.currentTarget;
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', open);
    button.querySelector('.chev').textContent = open ? '▾' : '▴';
    $('#statsRows').hidden = !open;
    $('#sideStats').classList.toggle('open', open);
    setPref('statsOpen', open ? '1' : '0');
}
function onGoalsClick(event, model) {
    const find = event.target.closest('[data-find]');
    if (find) {
        hooks.find?.(find.dataset.find);
        return;
    }
    if (event.target.closest('#achBtn')) {
        $('#achBody').innerHTML = achievementsHtml(hooks.side);
        $('#achDlg').showModal();
        return;
    }
    const goalRow = event.target.closest('[data-goal]');
    if (goalRow) pickGoal(model, goalRow.dataset.goal);
}
function onAreasClick(event, filters, changed) {
    if (event.target.closest('[data-areas]')) {
        toggleAreaList();
        refreshSideAreas();
        $('#sideAreas [data-areas]')?.focus({ preventScroll: true });
        return;
    }
    const group = event.target.closest('[data-grp]');
    if (group) {
        const groupKey = group.dataset.grp;
        toggleLayerGroup(groupKey);
        refreshSideAreas();
        $(`#sideAreas [data-grp="${groupKey}"]`)?.focus({ preventScroll: true });
        return;
    }
    const finished = event.target.closest('[data-fin]');
    if (finished) {
        toggleFinished();
        refreshSideAreas();
        $(`#sideAreas [data-fin="${finished.dataset.fin}"]`)?.focus({ preventScroll: true });
        return;
    }
    const area = event.target.closest('[data-area]');
    if (!area) return;
    filters.area = filters.area === area.dataset.area ? '' : area.dataset.area;
    changed();
    if (filters.area !== '') hooks.area?.();
}

// the search box applies its text once typing pauses
let searchTimer = 0;
export function renderSide(model) {
    const side = $('#sidePanels'),
        campaignList = campaigns();
    if (!campaignList.length) {
        side.innerHTML = $('#sideCamp').innerHTML = '';
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
    $('#refreshBtn')?.addEventListener('click', refresh);
    if (!model) return;
    $('#inLevel')?.addEventListener('click', () => hooks.open?.(model.inLevel));
    const filters = model.F;
    const changed = () => (hooks.apply ? hooks.apply() : show());
    $('#fQ').addEventListener('input', (event) => {
        const query = event.target.value.toLowerCase().trim();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            filters.q = query;
            changed();
        }, 120);
    });
    hooks.side = model;
    segOn($('#pgSpoil'), model.hide);
    $('#pgSpoil').addEventListener('click', () => {
        setSpoilersHidden(!spoilersHidden);
        setPref('hideSpoilers', spoilersHidden ? '1' : '0');
        show();
    });
    $('#statsTog')?.addEventListener('click', onStatsToggle);
    $('#sideGoals').addEventListener('click', (event) => onGoalsClick(event, model));
    $('.side .stats')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-find]');
        if (button) hooks.find?.(button.dataset.find);
    });
    $('#sideAreas')?.addEventListener('click', (event) => onAreasClick(event, filters, changed));
    syncSide(filters);
}
export function refreshSideAreas() {
    const element = $('#sideAreas');
    if (!element || !hooks.side) return;
    element.innerHTML = sideAreasHtml(hooks.side);
    element.classList.toggle('open', areaListOpen());
    syncSide(hooks.side.F);
}
// the sidebar's controls show the filters: the search text, the totals row framed on the map and the picked area
export function syncSide(filters) {
    if (!$('#fQ')) return;
    if (document.activeElement !== $('#fQ')) $('#fQ').value = filters.q;
    $('#sidebar')
        .querySelectorAll('[data-find]')
        .forEach((button) => segOn(button, button.dataset.find === filters.find));
    $('#sideAreas')
        ?.querySelectorAll('[data-area]')
        .forEach((area) => segOn(area, area.dataset.area === filters.area));
}
