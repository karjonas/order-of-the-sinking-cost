// The save files given to the page, by path, and the campaigns they make up (SAVES.md "Files and versions")
import { PROG } from './data.js';
import { walkReady } from './walk-data.js';
import { apolloDate } from './util.js';
import { parseHistory, parseStatus } from './save.js';
import { state } from './shared.js';
import { show } from './view.js';

// only the campaign status and the overworld history (for fog) are read
export const SAVE_RE = /(\.sokoban_status|(^|\/)overworld\.history)$/i;
export function relPath(file) {
    return (file.webkitRelativePath || file.fsPath || file.name).replace(/\\/g, '/');
}
export const newFile = (path, file, old) => ({
    path,
    file,
    buf: null,
    parsed: null,
    error: null,
    warning: null,
    last: old?.parsed || old?.last || null,
});
const isStatus = (entry) => entry.path.endsWith('.sokoban_status');
// reads one file: a history that stops partway keeps a last whole parse, else the records read before the bad one are
// used; a file the game is still writing keeps its last good parse until the next read
function parseEntry(entry) {
    try {
        const parsed = entry.path.endsWith('.history') ? parseHistory(entry.buf) : parseStatus(entry.buf);
        if (parsed.error) console.warn(entry.path, parsed.error);
        if (parsed.error && entry.last && !entry.last.error) {
            entry.parsed = entry.last;
            return;
        }
        entry.parsed = parsed;
        entry.warning = parsed.error ? `read up to record ${parsed.records}; ${parsed.error}` : null;
        entry.last = null;
    } catch (err) {
        if (entry.last) {
            entry.parsed = entry.last;
            console.warn(entry.path, err);
        } else {
            entry.error = err.message;
            console.error(entry.path, err);
        }
    }
}
// state.loadError: why the last files given opened nothing, shown under the banner until a campaign status loads
export async function addFiles(list) {
    const added = [];
    for (const file of list) {
        const path = relPath(file);
        if (!SAVE_RE.test(path)) continue;
        state.files.set(path, newFile(path, file, state.files.get(path)));
        added.push(path);
    }
    // files without a campaign status open nothing: the page keeps what it shows
    if (list.length && !realFiles().some(isStatus)) {
        for (const path of added) state.files.delete(path);
        state.loadError = 'No Status.sokoban_status in the dropped folder';
        if (state.camp != null) show();
        else showDemo();
        return;
    }
    if (added.some((path) => path.endsWith('.sokoban_status'))) state.loadError = null;
    if (realFiles().some(isStatus)) for (const [path, entry] of state.files) if (entry.demo) state.files.delete(path);
    await Promise.all(
        [...state.files.values()]
            .filter((entry) => !entry.buf)
            .map(async (entry) => {
                entry.buf = new Uint8Array(await entry.file.arrayBuffer());
            }),
    );
    await walkReady;
    for (const entry of state.files.values()) if (!entry.parsed && !entry.error) parseEntry(entry);
    const camps = campaigns();
    // follows the campaign the game saved last until one is picked by hand
    if (!state.campPicked || !camps.includes(state.camp)) state.camp = newestCampaign(camps);
    if (state.camp != null) show();
    else showDemo();
}
// Before any save is loaded the page shows an empty save: no progress, and the fog and hero of a new campaign walked
// everywhere it can reach (fog.start, from scripts/build-fog.js).
export const SAVE_PATH = '%USERPROFILE%\\Saved Games\\Order of the Sinking Star';
const DEMO_DIR = 'No save loaded';
const DEMO_STATUS = {
    version: 33,
    rank: 0,
    achievements: 0n,
    treasureFlags: 0,
    artifacts: 0n,
    levels: [],
    openedFreezers: [],
};
// region states with the given regions cleared (state 2)
function clearedRegions(size, regions) {
    const states = new Uint8Array(size);
    for (const region of regions) if (region < states.length) states[region] = 2;
    return states;
}
function demoHistory() {
    const history = {
            version: 0,
            types: [],
            actions: [],
            hero: null,
            heroKey: -1,
            fogStates: new Map(),
            demo: true,
        },
        fog = PROG.fog;
    if (!fog) return history;
    const [columns, rows] = fog.grid.count,
        sizeOf = (pid) => (fog.primary.some((primary) => primary.pid === pid) ? columns * rows : 1);
    history.hero = fog.start.hero;
    history.pinsOn = fog.start.pins;
    for (const [pid, regions] of Object.entries(fog.start.regions))
        history.fogStates.set(+pid, clearedRegions(sizeOf(+pid), regions));
    return history;
}
export const realFiles = () => [...state.files.values()].filter((entry) => !entry.demo);
export async function showDemo() {
    if (realFiles().some(isStatus)) return;
    await walkReady;
    if (realFiles().some(isStatus) || state.camp != null) return;
    for (const [name, parsed] of [
        ['Status.sokoban_status', DEMO_STATUS],
        ['overworld.history', demoHistory()],
    ]) {
        const path = `${DEMO_DIR}/${name}`;
        state.files.set(path, { path, file: null, buf: new Uint8Array(0), parsed, error: null, demo: true });
    }
    state.camp = DEMO_DIR;
    show();
}
export function campaignOf(path) {
    const parts = path.split('/');
    return parts.length >= 2 ? parts[parts.length - 2] : '';
}
export function baseName(path) {
    return path.split('/').pop();
}
export function campaigns() {
    const statusFiles = [...state.files.values()].filter((entry) => entry.path.endsWith('.sokoban_status'));
    return [...new Set(statusFiles.map((entry) => campaignOf(entry.path)))].toSorted();
}
export const statusEntry = (camp) =>
    [...state.files.values()].find(
        (entry) => entry.path.endsWith('.sokoban_status') && campaignOf(entry.path) === camp,
    );
// a campaign's save times for picking the newest: the status's saved time, then the file's
function savedAt(camp) {
    const entry = statusEntry(camp),
        status = entry?.parsed;
    return [
        status?.savedLo != null ? apolloDate(status.savedLo, status.savedHi).getTime() : -Infinity,
        entry?.file?.lastModified || 0,
    ];
}
// the game opens the campaign saved last (by the status's saved time, then by the file's)
function newestCampaign(camps) {
    const newer = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]);
    return camps.reduce(
        (newest, camp) => (newest == null || newer(savedAt(camp), savedAt(newest)) ? camp : newest),
        null,
    );
}
export const campLabel = (camp) => camp || 'Saves';
export const historyEntry = (camp) =>
    [...state.files.values()].find(
        (entry) => entry.parsed && campaignOf(entry.path) === camp && baseName(entry.path) === 'overworld.history',
    );
