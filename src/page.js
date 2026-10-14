// Draws the page for the current campaign: the sidebar, the progress view and the banner (VIEWER.md "The page
// (viewer)")
import { PROG } from './data.js';
import { $, esc, hex } from './util.js';
import { resetHooks, state } from './shared.js';
import { baseName, statusEntry } from './files.js';
import { progressModel } from './model/progress-model.js';
import { renderSide } from './sidebar.js';
import { renderProgress } from './panels.js';
import { pickerHelpHtml } from './folder.js';
import { setPageDrawing } from './view.js';

// a redraw of the same campaign keeps these scroll positions and the focused element (by id, else by its child-index
// path from the nearest element with an id)
const KEEP_SCROLL = ['#sidebar', '#sideAreas', '#pgRows', '#pgMap .sel'];
function focusPath(el) {
    if (!el || el === document.body) return null;
    const path = [];
    for (; !el.id; el = el.parentElement) {
        if (!el.parentElement) return null;
        path.unshift([...el.parentElement.children].indexOf(el));
    }
    return [el.id, path];
}
const fromPath = ([id, path]) => path.reduce((n, k) => n?.children[k], document.getElementById(id));
function drawPage() {
    const main = $('#main'),
        key = state.camp,
        fresh = state.rendered !== key,
        top = main.scrollTop,
        winTop = scrollY;
    const act = document.activeElement,
        fp = focusPath(act),
        caret = act?.selectionStart != null ? [act.selectionStart, act.selectionEnd] : null;
    const scrolls = KEEP_SCROLL.map((q) => $(q)?.scrollTop);
    state.rendered = key;
    // hooks into the last drawn progress view; the draw below sets the ones it has
    resetHooks();
    const e = statusEntry(state.camp),
        M = e?.parsed && PROG.levels ? progressModel(state.camp) : null;
    renderSide(M);
    $('#results').innerHTML = $('#banner').innerHTML = '';
    if (!e) main.innerHTML = '';
    else if (e.error)
        main.innerHTML = `<h2>${esc(baseName(e.path))}</h2><div class="err">Failed to parse: ${esc(e.error)}</div><details><summary>First bytes</summary><pre class="mono">${hex(e.buf, 256)}</pre></details>`;
    else if (!M) main.innerHTML = '<div class="err">This build has no level data.</div>';
    else renderProgress(M);
    if (state.pickerHelp) $('#banner').insertAdjacentHTML('beforeend', pickerHelpHtml());
    if (state.loadError) $('#banner').insertAdjacentHTML('beforeend', `<div class="err">${esc(state.loadError)}</div>`);
    if (fresh) {
        main.scrollTop = 0;
        scrollTo(0, 0);
    } else {
        main.scrollTop = top;
        scrollTo(0, winTop);
        KEEP_SCROLL.forEach((q, k) => {
            const el = $(q);
            if (el && scrolls[k] != null) el.scrollTop = scrolls[k];
        });
    }
    // the redraw replaces the elements; keep the focus (and typing in a search box) where it was
    const el = fp && fromPath(fp);
    if (
        el &&
        el !== document.activeElement &&
        (!fresh || el.closest('#sidebar')) &&
        el.matches('input, select, button, [tabindex], a[href]')
    ) {
        el.focus({ preventScroll: true });
        if (caret && el.setSelectionRange && el.value?.length >= caret[1])
            try {
                el.setSelectionRange(...caret);
            } catch {}
    }
}
setPageDrawing(drawPage);
