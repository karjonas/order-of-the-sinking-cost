// The page's entry (VIEWER.md "The page (viewer)"): loads the folder and page modules and wires the page-wide keys and
// clicks
import './folder.ts';
import './page.ts';
import { $ } from './util.ts';
import { hooks, state } from './shared.ts';
import { addFiles, campaigns } from './files.ts';
import { activeMap } from './map/map-view.ts';
import { revealLevel } from './sidebar.ts';

// the achievements dialog: a click on a level in it opens the level's panel
const achievementsDialog = $('#achDlg');

if (!(achievementsDialog instanceof HTMLDialogElement)) throw new Error('The page has no achievements dialog');

achievementsDialog.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // a click on the backdrop lands on the dialog itself
    if (target === achievementsDialog || target.closest('[data-close]')) {
        achievementsDialog.close();
        return;
    }

    const chip = target.closest<HTMLElement>('[data-goto]');
    if (chip && !chip.classList.contains('spoiler')) {
        achievementsDialog.close();
        hooks.open?.(Number(chip.dataset.goto));
    }
});

// a fogged chip's first click reveals its level (and eats the click); the redrawn chip then works like any other
document.addEventListener(
    'click',
    (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const fogged = target.closest<HTMLElement>('.spoiler');
        if (!fogged) return;

        event.preventDefault();
        event.stopPropagation();
        const level = fogged.dataset.goto ?? fogged.dataset.pick;
        if (level != null) revealLevel(Number(level));
    },
    true,
);

document.addEventListener('keydown', (event) => {
    // the dialog closes itself
    if (event.key === 'Escape' && achievementsDialog.open) return;

    if (event.key === 'Escape' && activeMap?.open) {
        activeMap.select(null);
        return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (event.key === 'Escape' && activeMap && !target?.closest('input, select, dialog')) activeMap.reset();
    if ((event.key === 'Enter' || event.key === ' ') && target?.matches('[role=button]:not(button)')) {
        event.preventDefault();
        if (target instanceof HTMLElement) target.click();
    }
});

// for the console and test pages
Object.assign(window, { addFiles, campaigns, state });
