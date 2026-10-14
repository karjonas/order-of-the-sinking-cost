// Opening saves (SAVES.md "Files and versions"): the file picker, the live folder with its polling, and drag and drop
import { $, esc } from './util.js';
import { pref, progressFilters, revealed, setPref, state } from './shared.js';
import { addFiles, newFile, realFiles, relPath, SAVE_PATH, SAVE_RE, showDemo } from './files.js';
import { mapViews } from './map/map-html.js';
import { activeMap, onGestureEnd } from './map/map-view.js';
import { hashDone, panelKeep, setHash } from './panels/hash.js';
import { show } from './view.js';

// files picked or dropped by hand; a failure to read them shows under the banner
function loadFailed(err) {
    console.error(err);
    state.loadError = `Could not read the files: ${err.message || err}`;
    show();
}
const openFiles = (list) => addFiles(list).catch(loadFailed);
// a one-time read of the files as they are now; one with a campaign status replaces the live folder
function openSnapshot(list) {
    state.pickerHelp = false;
    if ([...list].some((f) => /\.sokoban_status$/i.test(relPath(f)))) {
        folderGen++;
        dirHandle = null;
    }
    return openFiles(list);
}
$('#dirInput').addEventListener('change', (ev) => openSnapshot(ev.target.files));

// Live folder: with the File System Access API the folder handle is kept (and remembered in IndexedDB), so changed
// saves are re-read every 5 s while the page is visible, when the tab becomes visible or the window gets focus, and on
// ↻. Other browsers fall back to a one-time file input.
// lastHandle: the folder opened last, kept after it is closed so reopening it keeps the per-campaign state
export let dirHandle = null;
let lastHandle = null,
    refreshing = null,
    folderGen = 0;
const idb = (mode, fn) =>
    new Promise((res, rej) => {
        const rq = indexedDB.open('sinking-star-viewer', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
        rq.addEventListener('error', () => rej(rq.error));
        rq.onsuccess = () => {
            try {
                const tx = rq.result.transaction('kv', mode),
                    r = fn(tx.objectStore('kv'));
                tx.oncomplete = () => res(r?.result);
                tx.addEventListener('error', () => rej(tx.error));
            } catch (err) {
                rej(err);
            } // a value that cannot be stored
        };
    });
async function readDir(handle, prefix, out) {
    for await (const [name, h] of handle.entries()) {
        if (h.kind === 'directory') await readDir(h, prefix + name + '/', out);
        else if (SAVE_RE.test(name)) {
            const f = await h.getFile();
            f.fsPath = prefix + name;
            out.push(f);
        }
    }
}
// Replaces entries whose size or modification time changed and drops deleted ones; returns whether anything changed.
// A folder switched while this runs makes it stop before it touches the files.
async function syncFolder() {
    const gen = folderGen,
        handle = dirHandle,
        out = [],
        prefix = handle.name + '/';
    await readDir(handle, prefix, out);
    if (gen !== folderGen) return false;
    let changed = false;
    const seen = new Set();
    for (const f of out) {
        const p = relPath(f),
            old = state.files.get(p);
        seen.add(p);
        if (old && old.file.size === f.size && old.file.lastModified === f.lastModified) continue;
        state.files.set(p, newFile(p, f, old));
        changed = true;
    }
    for (const p of Array.from(state.files.keys()))
        if (p.startsWith(prefix) && !seen.has(p)) {
            state.files.delete(p);
            changed = true;
        }
    if (changed) await addFiles([]);
    return changed;
}
// one read at a time; a call during a read waits for it. A redraw during a drag, pinch or eased zoom of the map would
// move it under the pointer, so the read waits for the gesture to end.
let refreshWaiting = false;
onGestureEnd(() => {
    if (refreshWaiting) {
        refreshWaiting = false;
        refresh();
    }
});
// now: read even during a gesture (a folder just opened, the ↻ button)
export function refresh(now) {
    if (!dirHandle) return Promise.resolve();
    if (!now && activeMap?.busy) {
        refreshWaiting = true;
        return Promise.resolve();
    }
    return (refreshing ||= (async () => {
        try {
            await syncFolder();
        } catch (err) {
            console.warn('refresh failed', err);
        } // a save being written mid-read; the next tick retries
        finally {
            refreshing = null;
            liveStatus();
        }
    })());
}
const relTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
const TIME_UNITS = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [2629800, 'day'],
    [31557600, 'month'],
    [Infinity, 'year'],
];
export function timeAgo(t) {
    const sec = (t - Date.now()) / 1000;
    let div = 1;
    for (const [lim, unit] of TIME_UNITS) {
        if (Math.abs(sec) < lim) return relTime.format(Math.round(sec / div), unit);
        div = lim;
    }
}
// only the text changes, so the ↻ button keeps the focus
function liveStatus() {
    const el = $('#savedAgo');
    if (el) el.textContent = timeAgo(Number(el.dataset.t));
}
async function useHandle(h) {
    folderGen++;
    await refreshing;
    // another folder may hold campaigns of the same names: what was revealed, filtered or viewed there does not carry over
    const same = !!lastHandle && (await lastHandle.isSameEntry(h).catch(() => false));
    if (!same) for (const o of [revealed, progressFilters, mapViews]) for (const k of Object.keys(o)) delete o[k];
    lastHandle = h;
    dirHandle = h;
    pendingHandle = null;
    state.pickerHelp = false;
    syncFolderUi();
    state.camp = null;
    state.campPicked = false;
    state.rendered = null;
    if (hashDone) {
        for (const k of Object.keys(panelKeep)) delete panelKeep[k];
        setHash('');
    }
    for (const p of Array.from(state.files.keys())) state.files.delete(p);
    await refresh(true);
    if (!realFiles().length) showDemo();
    try {
        await idb('readwrite', (s) => s.put(h, 'dir'));
    } catch {}
}
// A page in a cross-origin frame may not open the folder picker or ask for a folder's permission again; a dropped
// folder still comes with a live handle. Without a picker the page says so and offers the folder input.
const PICKER_KEY = 'folderPickerBlocked';
let pickerBlocked = pref(PICKER_KEY, 'sessionStorage') === '1';
const crossFrame = (() => {
    try {
        return window.top !== window && !window.top.location.href;
    } catch {
        return true;
    }
})();
export const dropsLive = 'getAsFileSystemHandle' in (window.DataTransferItem?.prototype || {});
function needPicker() {
    state.pickerHelp = true;
    show();
}
// why there is no folder picker, and the other ways in
function pickerHelpText() {
    if (!window.showDirectoryPicker && !dropsLive)
        return 'This browser can’t keep a folder open. Pick the save folder as a one-time snapshot, or drag it onto the page.';
    const noPicker = 'This page can’t open a folder picker here.';
    if (dropsLive)
        return `${noPicker} Drag the save folder onto the page to keep it updating live, or pick it as a one-time snapshot.`;
    return `${noPicker} Pick the save folder as a one-time snapshot.`;
}
export function pickerHelpHtml() {
    const msg = pickerHelpText();
    // the example view's banner above already shows the path
    const path = $('#bnPath')
        ? ''
        : `<code>${esc(SAVE_PATH)}</code><button data-copy-path title="Copy the folder path">Copy path</button>`;
    return `<div class="banner" id="pickHelp"><span class="bt">${msg}</span>${path}<button class="primary" data-snapshot>Pick a snapshot…</button></div>`;
}
document.addEventListener('click', (ev) => {
    if (ev.target.closest('#pickHelp [data-snapshot]')) $('#dirInput').click();
    else if (ev.target.closest('#pickHelp [data-copy-path]'))
        copyPath({ currentTarget: ev.target.closest('[data-copy-path]') });
});
export async function pickFolder() {
    if (!window.showDirectoryPicker || pickerBlocked) {
        needPicker();
        return;
    }
    let h;
    try {
        h = await showDirectoryPicker({ id: 'saves', mode: 'read' });
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn(err);
        // a lost click (after a refused reconnect) is a SecurityError too, but only for this try
        if (err.name === 'SecurityError' && (crossFrame || /cross.origin/i.test(err.message))) {
            pickerBlocked = true;
            setPref(PICKER_KEY, '1', 'sessionStorage');
        }
        needPicker();
        return;
    }
    await useHandle(h);
}
// a remembered folder that needs a click to grant permission again
let pendingHandle = null;
// the label of the buttons that open the save folder
export const folderLabel = () => (pendingHandle ? 'Reconnect save folder' : 'Open save folder');
function syncFolderUi() {
    $('#openDir').textContent = folderLabel();
    $('#openDir').title = pendingHandle ? `Reconnect “${pendingHandle.name}”` : '';
    const b = $('#bnOpen');
    if (b) b.textContent = folderLabel();
}
export async function folderAction() {
    if (!pendingHandle) {
        pickFolder();
        return;
    }
    const h = pendingHandle;
    let ok = false;
    if (!pickerBlocked && !crossFrame)
        try {
            ok = (await h.requestPermission({ mode: 'read' })) === 'granted';
        } catch (err) {
            console.warn(err);
        }
    if (ok) {
        await useHandle(h);
        return;
    }
    // refused, or a frame that may not ask again: the folder is forgotten and the picker opens instead (a click on
    // "Open save folder" when the browser wants a fresh one), or the page says it has none
    await forgetFolder();
    pickFolder();
}
// drops the remembered folder of the last visit
async function forgetFolder() {
    pendingHandle = null;
    syncFolderUi();
    try {
        await idb('readwrite', (s) => s.delete('dir'));
    } catch {}
}
// without clipboard access the path is selected for copying by hand
export async function copyPath(ev) {
    const b = ev.currentTarget,
        say = (t) => {
            b.textContent = t;
            setTimeout(() => {
                b.textContent = 'Copy path';
            }, 1500);
        };
    try {
        await navigator.clipboard.writeText(SAVE_PATH);
        say('Copied');
    } catch {
        const r = document.createRange();
        r.selectNodeContents(b.parentElement.querySelector('code') || $('#bnPath'));
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {}
        say(ok ? 'Copied' : 'Press Ctrl+C');
    }
}
$('#openDir').addEventListener('click', folderAction);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
});
addEventListener('focus', () => refresh());
setInterval(() => {
    if (!document.hidden) liveStatus();
}, 10000);
// polls the connected folder; an unchanged folder re-renders nothing
setInterval(() => {
    if (dirHandle && !document.hidden) refresh();
}, 5000);
// offer the folder from the last visit; reading it again needs a click to grant permission
(async () => {
    if (!window.showDirectoryPicker) return;
    let h;
    try {
        h = await idb('readonly', (s) => s.get('dir'));
    } catch {
        return;
    }
    if (!h || realFiles().length) return;
    if ((await h.queryPermission({ mode: 'read' })) === 'granted') {
        useHandle(h);
        return;
    }
    pendingHandle = h;
    syncFolderUi();
})();
showDemo();

async function walkEntry(entry, prefix, out) {
    if (entry.isFile) {
        if (SAVE_RE.test(prefix + entry.name)) {
            const f = await new Promise((res, rej) => entry.file(res, rej));
            f.fsPath = prefix + entry.name;
            out.push(f);
        }
    } else if (entry.isDirectory) {
        const rd = entry.createReader();
        let batch;
        do {
            batch = await new Promise((res, rej) => rd.readEntries(res, rej));
            for (const c of batch) await walkEntry(c, prefix + entry.name + '/', out);
        } while (batch.length);
    }
}
// enter/leave fire for every element crossed, so the overlay follows a counter
let dragDepth = 0;
const dragging = (on) => document.body.classList.toggle('dragging', on);
document.addEventListener('dragenter', (ev) => {
    if (![...ev.dataTransfer.types].includes('Files')) return;
    dragDepth++;
    dragging(true);
});
document.addEventListener('dragleave', () => {
    if (dragDepth && !--dragDepth) dragging(false);
});
document.addEventListener('dragover', (ev) => ev.preventDefault());
document.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    dragDepth = 0;
    dragging(false);
    // the drag data is only readable synchronously, so take everything before the first await
    const items = [...ev.dataTransfer.items].filter((i) => i.kind === 'file'),
        files = [...ev.dataTransfer.files];
    const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean),
        handles = items.map((i) => i.getAsFileSystemHandle?.()).filter(Boolean);
    // a dropped folder with a handle becomes a live folder, like a picked one; without one it is read once
    const dir = (await Promise.all(handles.map((p) => p.catch(() => null)))).find((h) => h?.kind === 'directory');
    if (dir) {
        useHandle(dir);
        return;
    }
    const out = [];
    try {
        for (const it of entries) await walkEntry(it, '', out);
    } catch (err) {
        loadFailed(err);
        return;
    }
    openSnapshot(out.length ? out : files);
});
