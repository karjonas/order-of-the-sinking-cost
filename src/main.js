// The page's entry (VIEWER.md "The page (viewer)"): loads the folder and page modules and wires the page-wide keys and
// clicks
import './folder.js';
import './page.js';
import { $ } from './util.js';
import { hooks, state } from './shared.js';
import { addFiles, campaigns } from './files.js';
import { activeMap } from './map/map-view.js';
import { revealLevel } from './sidebar.js';

// the achievements dialog: a click on a level in it opens the level's panel
$('#achDlg').addEventListener('click', (ev) => {
    const dlg = $('#achDlg');
    if (ev.target === dlg || ev.target.closest('[data-close]')) {
        dlg.close();
        return;
    } // a click on the backdrop lands on the dialog itself
    const chip = ev.target.closest('[data-goto]');
    if (chip && !chip.classList.contains('spoiler')) {
        dlg.close();
        hooks.open?.(Number(chip.dataset.goto));
    }
});

// a fogged chip's first click reveals its level (and eats the click); the redrawn chip then works like any other
document.addEventListener(
    'click',
    (ev) => {
        const fogged = ev.target.closest('.spoiler');
        if (!fogged) return;
        ev.preventDefault();
        ev.stopPropagation();
        const level = fogged.dataset.goto ?? fogged.dataset.pick;
        if (level != null) revealLevel(Number(level));
    },
    true,
);
document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && $('#achDlg').open) return; // the dialog closes itself
    if (ev.key === 'Escape' && activeMap?.open) {
        activeMap.select(null);
        return;
    }
    if (ev.key === 'Escape' && activeMap && !ev.target.closest?.('input, select, dialog')) activeMap.reset();
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('[role=button]:not(button)')) {
        ev.preventDefault();
        ev.target.click();
    }
});

// for the console and test pages
Object.assign(window, { addFiles, campaigns, state });
