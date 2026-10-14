// The sidebar's save summary: where the save is, the achievements dialog and the save's stats
// (VIEWER.md "The page (viewer)", "The spoiler model (viewer)")
import { PROG, SCHEMA } from '../data.js';
import { esc, prettyAch } from '../util.js';
import { pref } from '../shared.js';
import { achievementRules, hasAchievement } from '../model/achievements.js';
import { levelChip } from '../panels/plan-chips.js';
import { areaName } from './areas.js';

const achievementList = () => (SCHEMA.enums.Achievement?.values || []).filter(([, value]) => value > 0);

// what earns an achievement: its rule's text, its levels and its tower's count
function earnedByHtml(rule, progress) {
    if (!rule) return '';
    let html = esc(rule.text);
    if (rule.levels) html += ' ' + rule.levels.map((i) => levelChip(progress, i)).join('');
    if (rule.tower) html += ` <span class="muted">${rule.tower.solvedNormal} / ${rule.tower.req}</span>`;
    return html;
}
// every achievement not hidden and what earns it; the hidden ones are summed up in one line
export function achievementsHtml(model) {
    const rules = achievementRules(model.progress);
    const shown = achievementList().filter(([name]) => !model.achievementHidden(name));
    const secretCount = achievementList().length - shown.length;
    const rows = shown.map(([name]) => {
        const got = hasAchievement(model.status, name);
        const what = earnedByHtml(rules.get(name), model.progress);
        return `<div class="${got ? 'got' : ''}"><b>${got ? '✓ ' : ''}${esc(prettyAch(name))}</b><span class="muted">${what}</span></div>`;
    });
    let secret = '';
    if (secretCount) secret = '<div class="secret"><b>More achievements under fog</b></div>';
    return `<div class="ach">${rows.join('')}${secret}</div>`;
}

// Status gameplay counters by index (status +244..+280; index 3, +256, is never incremented)
const COUNTERS = [
    [0, 'Gems picked up'],
    [1, 'Gems placed'],
    [2, 'Artifacts picked up'],
    [4, 'Dragon follow toggles'],
    [5, 'Wand uses'],
    [6, 'Beam turns'],
    [7, 'Prism uses'],
    [8, 'Levels entered'],
    [9, 'Activate presses'],
];
export function statsHtml(model) {
    const open = pref('statsOpen') === '1';
    const number = (value) => Number(value).toLocaleString('en-US');
    const counters = model.status.counters;
    const rows = COUNTERS.filter(([index]) => counters?.[index] != null).map(([index, label]) => [
        label,
        number(counters[index]),
    ]);
    const rowsHtml = rows
        .map(([label, value]) => `<div class="kr"><span>${esc(label)}</span><span class="v">${value}</span></div>`)
        .join('');
    return `<div class="np sstats${open ? ' open' : ''}" id="sideStats"><div class="srows" id="statsRows"${open ? '' : ' hidden'}>${rowsHtml}</div><button class="plain stog" id="statsTog" aria-expanded="${open}" aria-controls="statsRows" title="Counters kept in the save"><span>Stats</span><i class="chev" aria-hidden="true">${open ? '▾' : '▴'}</i></button></div>`;
}

// always one line, so the sidebar keeps its geometry whatever the save is doing
export function inLevelHtml(status, model) {
    if (model?.inLevel != null)
        return `<button class="plain inlv" id="inLevel" title="Show it on the map"><span class="muted">In level:</span> <span class="n">${esc(model.levels[model.inLevel].n)}</span></button>`;
    if (model?.onOverworld) {
        let area = '';
        if (model.heroArea != null) area = ` <span class="muted">·</span> ${esc(areaName(PROG.areas[model.heroArea]))}`;
        return `<div class="inlv">On the overworld${area}</div>`;
    }
    let levelName = '';
    if (model && !model.demo) levelName = status?.currentLevel || '';
    return `<div class="inlv muted">${esc(levelName)}</div>`;
}
