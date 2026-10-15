// The sidebar's save summary: where the save is, the achievements dialog and the save's stats
// (VIEWER.md "The page (viewer)", "The spoiler model (viewer)")
import { PROG, SCHEMA } from '../data.ts';
import { escapeHtml } from '../util.ts';
import { readPreference } from '../shared.ts';
import { achievementName, achievementRules, hasAchievement } from '../model/achievements.ts';
import type { AchievementRule } from '../model/achievements.ts';
import { areaName } from '../model/areas.ts';
import type { ProgressModel } from '../model/progress-model.ts';
import type { ShownProgress } from '../model/progress.ts';
import { levelChip } from '../panels/plan-chips.ts';
import type { DemoStatus, Status } from '../status-file.ts';

const achievementList = () => (SCHEMA.enums.Achievement?.values || []).filter(([, value]) => value > 0);

// what earns an achievement: its rule's text, its levels and its tower's count
function earnedByHtml(rule: AchievementRule | undefined, progress: ShownProgress): string {
    if (!rule) return '';

    let html = escapeHtml(rule.text);
    if (rule.levels) html += ' ' + rule.levels.map((level) => levelChip(progress, level)).join('');
    if (rule.tower) html += ` <span class="muted">${rule.tower.solvedNormal} / ${rule.tower.req}</span>`;
    return html;
}

/** Every achievement not hidden and what earns it; the hidden ones are summed up in one line. */
export function achievementsHtml(model: ProgressModel): string {
    const rules = achievementRules(model.progress);
    const shown = achievementList().filter(([name]) => !model.achievementHidden(name));
    const secretCount = achievementList().length - shown.length;
    const rows = shown.map(([name]) => {
        const got = hasAchievement(model.status, name);
        const what = earnedByHtml(rules.get(name), model.progress);
        let gotClass = '';
        let gotMark = '';
        if (got) {
            gotClass = 'got';
            gotMark = '✓ ';
        }

        const title = `${gotMark}${escapeHtml(achievementName(name))}`;
        return `<div class="${gotClass}"><b>${title}</b><span class="muted">${what}</span></div>`;
    });

    let secret = '';
    if (secretCount) secret = '<div class="secret"><b>More achievements under fog</b></div>';
    return `<div class="ach">${rows.join('')}${secret}</div>`;
}

// Status gameplay counters by index (status +244..+280; index 3, +256, is never incremented)
const COUNTERS: Array<[index: number, label: string]> = [
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

export function statsHtml(model: ProgressModel): string {
    const open = readPreference('statsOpen') === '1';
    const counters = model.status.counters;

    // with spoilers hidden a zero counter is left out: its row would name a mechanic the player has not met
    const rowsHtml = COUNTERS.map(([index, label]) => {
        const value = counters?.[index];
        if (value == null || (model.hide && value <= 0)) return '';

        const count = value.toLocaleString('en-US');
        return `<div class="kr"><span>${escapeHtml(label)}</span><span class="v">${count}</span></div>`;
    }).join('');

    let openClass = '';
    let hidden = ' hidden';
    let chevron = '▴';
    if (open) {
        openClass = ' open';
        hidden = '';
        chevron = '▾';
    }

    const rows = `<div class="srows" id="statsRows"${hidden}>${rowsHtml}</div>`;
    const title = 'Counters kept in the save';
    const attributes = `id="statsTog" aria-expanded="${open}" aria-controls="statsRows" title="${title}"`;
    const chevronHtml = `<i class="chev" aria-hidden="true">${chevron}</i>`;
    const toggle = `<button class="plain stog" ${attributes}><span>Stats</span>${chevronHtml}</button>`;
    return `<div class="np sstats${openClass}" id="sideStats">${rows}${toggle}</div>`;
}

/** Always one line, so the sidebar keeps its geometry whatever the save is doing. */
export function inLevelHtml(status?: Status | DemoStatus | null, model?: ProgressModel | null): string {
    if (model?.inLevel != null) {
        const name = escapeHtml(model.levels[model.inLevel].n);
        const label = '<span class="muted">In level:</span>';
        const attributes = 'id="inLevel" title="Show it on the map"';
        return `<button class="plain inlv" ${attributes}>${label} <span class="n">${name}</span></button>`;
    }

    if (model?.onOverworld) {
        let area = '';
        if (model.heroArea != null) {
            area = ` <span class="muted">·</span> ${escapeHtml(areaName(PROG.areas[model.heroArea]))}`;
        }

        return `<div class="inlv">On the overworld${area}</div>`;
    }

    let levelName = '';
    if (model && !model.demo) levelName = status?.currentLevel || '';
    return `<div class="inlv muted">${escapeHtml(levelName)}</div>`;
}
