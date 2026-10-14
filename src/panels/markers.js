// What the map draws for the progress view: the level markers by state or role, the towers, the area labels, the
// overlays (ice gates, signs, pads, gold rooms, voice logs, map scrolls, treasures) and the key
// (VIEWER.md "The page (viewer)", "The spoiler model (viewer)")
import { PROG } from '../data.js';
import { esc, prettyAch } from '../util.js';
import { FOG_LAYER_KEYS, layerName, mapLayerOf } from '../model/layers.js';
import { stLabel } from '../model/progress.js';
import { roleFor } from '../model/goal-roles.js';
import { towerName } from '../model/towers.js';
import {
    achIcon,
    OV_PATHS,
    ringIcon,
    ROLE_SHAPES,
    ROLES,
    shapeIcon,
    starIcon,
    STATE_COLORS,
    towerIcon,
} from '../map/icons.js';
import { areaName } from '../sidebar/areas.js';
import { FOG_TEXT, gateMode, signNeed, signText, stateDot, towerNameHtml } from './plan-chips.js';

// Which overlay markers the map draws: what is left to do for the goal. Ice gates that are open or that the goal does not
// need, signs satisfied, and teleporters, gold rooms, logs, map scrolls and treasures found are left out, unless the
// Solved chip asks for what is done.
export const markerShown = (overlay, solvedShown) => solvedShown || (!overlay.done && overlay.req !== false);
// the order markers are drawn in: solved, then the ones coloured by state (locked, blocked), then playable ones, then
// playable ones on the goal's cheapest plans, then the level the save is in
function drawRank(solved, stateColored, onPlan, current) {
    if (current) return 4;
    if (solved) return 0;
    if (stateColored) return 1;
    if (onPlan) return 3;
    return 2;
}
// solved, locked and blocked levels by state; playable ones by their role for the goal, with a ring once entered
function colorOf(context, i) {
    const levelState = context.progress.state[i];
    if (levelState === 'solved' || levelState === 'locked' || levelState === 'blocked') return ['s', levelState];
    const role = context.entries.get(i)?.role;
    if (role) return ['r', role];
    return ['s', 'unlocked'];
}
// what a level's role for the goal says in its tooltip
function roleTip(context, i) {
    const role = context.entries.get(i)?.role;
    if (!role) return '';
    return ` · ${ROLES[role][0]}`;
}
const KEY_ITEMS = [
    ['s:solved', 'Solved', STATE_COLORS.solved],
    ...Object.entries(ROLES).map(([role, [label, color]]) => ['r:' + role, label, color]),
    ['s:unlocked', 'Reachable', STATE_COLORS.unlocked],
    ['s:blocked', 'Blocked', STATE_COLORS.blocked],
    ['s:locked', 'Locked', STATE_COLORS.locked],
];
function keyIcon(colorKey, color) {
    if (colorKey === 's:solved') return starIcon(color);
    if (colorKey.startsWith('r:')) return shapeIcon(ROLE_SHAPES[colorKey.slice(2)], color);
    return shapeIcon('circle', color);
}
// the key lists only the colours of markers the current filter draws on the map's layer
export function keyHtml(context) {
    if (!context.goalIds.some((i) => context.match(i))) {
        if (context.narrowed())
            return '<span class="none">No levels match</span><button data-clear>Clear filters</button>';
        return '';
    }
    const shown = context.goalIds.filter((i) => context.match(i) && context.inView(i));
    if (!shown.length) return '';
    const used = new Set(shown.map((i) => colorOf(context, i).join(':')));
    let html = KEY_ITEMS.filter(([colorKey]) => used.has(colorKey))
        .map(([colorKey, label, color]) => `<span>${keyIcon(colorKey, color)}${label}</span>`)
        .join('');
    if (shown.some((i) => context.started(i))) html += `<span>${ringIcon}Entered</span>`;
    if (shown.some((i) => context.towerShown(i))) html += `<span>${towerIcon}Tower level</span>`;
    if (shown.some((i) => context.levels[i].a)) html += `<span>${achIcon}Achievement</span>`;
    return html;
}

// a level marker per level; a fogged tower stays unnamed on the levels it owns
export function levelMarkers(context) {
    const progress = context.progress;
    return context.levels.map((level, i) => {
        let tower = '';
        if (context.towerShown(i)) tower = `<br>${esc(towerName(level.t))}${level.d ? ' · dropdown' : ''}`;
        const fi = context.iceOf[i];
        let ice;
        if (fi != null) ice = { id: 'g' + fi, open: progress.gateOpen[fi] };
        return {
            i,
            x: level.p[0],
            y: level.p[1],
            z: level.p[2],
            ice,
            get tip() {
                let achievement = '';
                if (level.a) achievement = `<br>${esc(prettyAch(level.a))}`;
                let gate = '';
                if (fi != null) gate = `<br>In an ice gate · ${progress.gateOpen[fi] ? 'Open' : 'Closed'}`;
                return `<b>${esc(level.n)}</b><br>${stLabel(progress, progress.state[i])}${roleTip(context, i)}${tower}${achievement}${gate}`;
            },
        };
    });
}
export function towerMarkers(context) {
    const progress = context.progress;
    return progress.towers
        .map((tower, i) => ({
            i,
            x: tower.p[0],
            y: tower.p[1],
            z: tower.p[2],
            on: tower.active,
            tip: `<b>${esc(towerName(tower.t))}</b><br>${tower.solvedNormal} / ${tower.req} solved${tower.active ? ' · activated' : ''}`,
        }))
        .filter((tower) => !progress.towerHidden[tower.i]);
}
// the names of the areas shown; bigger areas first, so they keep their label when labels crowd
export function areaLabels(context) {
    const model = context.model;
    const size = context.areas.map(() => 0);
    model.levelArea.forEach((area) => {
        if (area != null) size[area]++;
    });
    return context.areas
        .map((area, areaIndex) => [area, size[areaIndex], areaIndex])
        .filter(
            ([area, , areaIndex]) =>
                area.p && model.areaShown(areaIndex) && model.shownAt(mapLayerOf(area.p[2]), area.p),
        )
        .toSorted((a, b) => b[1] - a[1])
        .map(([area]) => ({ x: area.p[0], y: area.p[1], z: area.p[2], text: areaName(area) }));
}
// how a level marker is drawn: hidden when the filter leaves it out, its colour, shape and rank
export function markerStyle(context, marker) {
    const i = marker.i,
        progress = context.progress,
        [kind, value] = colorOf(context, i),
        current = i === context.model.inLevel;
    const solved = progress.state[i] === 'solved';
    const rank = drawRank(solved, kind === 's', context.entries.get(i)?.onPlan, current);
    return {
        hidden: !context.match(i),
        gone: progress.hidden[i],
        color: kind === 's' ? STATE_COLORS[value] : ROLES[value][1],
        star: solved,
        shape: kind === 'r' ? ROLE_SHAPES[value] : 'circle',
        ring: context.started(i),
        big: context.towerShown(i),
        ach: !!context.levels[i].a,
        cur: current,
        rank,
    };
}

function levelNameHtml(context, j) {
    if (context.progress.hidden[j]) return FOG_TEXT;
    return stateDot(context.progress.state[j]) + esc(context.levels[j].n);
}
// overlays: ice gates, signs, MAJOR world pads, gold rooms at their hub endpoints, voice logs, map scrolls, treasure
// plinths; none under fog while it hides things
function gateOverlay(context, fi) {
    const progress = context.progress;
    const freezer = context.freezers[fi];
    // levels behind the gate that fog hides are left out of the count, not out of Next steps
    const isOpen = progress.gateOpen[fi],
        leads = progress.reach?.leads.get(fi)?.filter((j) => !progress.hidden[j]).length;
    const mode = gateMode(freezer);
    const options = [
        ...freezer.req.map((j) => levelNameHtml(context, j)),
        ...(freezer.signs || []).map((sign) => signText(context, sign)),
    ];
    const needs = `Opens with${mode ? ' ' + mode : ''}<br>${options.join('<br>')}`;
    const area = context.gateArea(fi);
    let tip = `<b>Ice gate</b>${area != null ? ` · ${esc(area)}` : ''}<br>`;
    if (isOpen) tip += 'Open';
    else {
        tip += `Closed<hr>${needs}`;
        if (leads)
            tip += `<hr><span class="muted">Leads to ${leads} level${leads > 1 ? 's' : ''} not reached (approx.)</span>`;
    }
    return {
        id: 'g' + fi,
        attr: `data-gate="${fi}"`,
        merge: context.iceLevel.get(fi),
        kind: 'gates',
        done: isOpen,
        req: roleFor(context.goal, 'g', fi) !== 'optional',
        layer: FOG_LAYER_KEYS[freezer.l],
        x: freezer.p[0],
        y: freezer.p[1],
        cls: 'gt' + (isOpen ? ' open' : ''),
        d: OV_PATHS.gate,
        tip,
    };
}
// signs that open gates open their panel; a tower status sign opens its tower's
function signOverlay(context, si) {
    const sign = context.signs[si],
        satisfied = context.progress.signOk(sign);
    let tip = `<b>Sign</b><br>${signNeed(context, sign)}<br>${satisfied ? 'Satisfied' : 'Not yet'}`;
    if (sign.status) {
        const tower = context.progress.towers[sign.tower];
        tip = `<b>Tower sign</b><br>${towerNameHtml(context, sign.tower)}<br>${tower.solvedNormal} / ${tower.req} solved${tower.active ? ' · activated' : ''}`;
    }
    return {
        id: 's' + si,
        attr: sign.status ? `data-gtw="${sign.tower}"` : `data-sign="${si}"`,
        kind: 'gates',
        done: satisfied,
        layer: FOG_LAYER_KEYS[sign.l],
        x: sign.p[0],
        y: sign.p[1],
        cls: 'sg' + (satisfied ? ' ok' : ''),
        d: OV_PATHS.sign,
        tip,
    };
}
// world pads only; their twins sit in the map rooms
function padOverlay(context, ti) {
    const pad = context.teleporters[ti],
        discovered = context.model.padDisc(ti);
    return {
        kind: 'tps',
        layer: FOG_LAYER_KEYS[pad.l],
        x: pad.p[0],
        y: pad.p[1],
        done: discovered,
        cls: 'tp' + (discovered ? '' : ' off'),
        d: OV_PATHS.tp,
        tip: `<b>Teleporter</b><br>${discovered ? 'Discovered' : 'Not discovered'}${context.progress.tst[ti].en ? '' : ' · disabled'}`,
    };
}
// a gold room is visited once its endpoint is discovered, and open once its tower is activated
function goldRoomState(context, room) {
    const states = context.progress.tst;
    if (states[room.endpoint].disc) return ['done', 'Visited'];
    const tower = context.progress.towers[room.tower];
    if (tower?.active || states[room.pad]?.en || states[room.endpoint].en) return ['unl', 'Open, not visited'];
    return ['', 'Locked'];
}
function goldRoomOverlay(context, room) {
    const progress = context.progress;
    const endpoint = context.teleporters[room.endpoint];
    const tower = progress.towers[room.tower];
    const [roomClass, label] = goldRoomState(context, room);
    let attr;
    if (tower && !progress.towerHidden[room.tower]) attr = `data-gtw="${room.tower}"`;
    let towerLine = '';
    if (tower) towerLine = `<br>${towerNameHtml(context, room.tower)}${tower.active ? ' · activated' : ''}`;
    return {
        kind: 'tps',
        layer: FOG_LAYER_KEYS[endpoint.l],
        x: endpoint.p[0],
        y: endpoint.p[1],
        done: !!progress.tst[room.endpoint].disc,
        cls: 'gr ' + roomClass,
        d: OV_PATHS.gold,
        attr,
        tip: `<b>Gold room</b><br>${label}${towerLine}`,
    };
}
function voiceLogOverlay(context, log) {
    const heard = context.model.heard(log);
    return {
        kind: 'logs',
        layer: FOG_LAYER_KEYS[log.l],
        x: log.p[0],
        y: log.p[1],
        done: heard,
        cls: 'vl' + (heard ? '' : ' off'),
        d: OV_PATHS.log,
        tip: `<b>${esc(log.name)}</b><br>${log.author ? esc(log.author) + ' · ' : ''}${heard ? 'Heard' : 'Not heard'}`,
    };
}
function mapScrollOverlay(context, giver) {
    const taken = context.model.taken(giver);
    return {
        kind: 'maps',
        layer: FOG_LAYER_KEYS[giver.l],
        x: giver.p[0],
        y: giver.p[1],
        done: taken,
        cls: 'vg' + (taken ? '' : ' off'),
        d: OV_PATHS.map,
        tip: `<b>Map scroll</b><br>${esc(layerName(FOG_LAYER_KEYS[giver.l]))} · ${taken ? 'Taken' : 'Not taken'}`,
    };
}
function treasureOverlay(plinth, acquired) {
    const got = acquired > plinth.i;
    return {
        kind: 'treasures',
        layer: mapLayerOf(plinth.p[2]),
        x: plinth.p[0],
        y: plinth.p[1],
        done: got,
        cls: 'tr' + (got ? '' : ' off'),
        d: OV_PATHS.treasure,
        tip: `<b>Treasure plinth ${plinth.i + 1}</b><br>${got ? 'Acquired' : 'Empty'}`,
    };
}
export function overlaysOf(context) {
    const model = context.model;
    const voiceLogs = PROG.voice_logs || [],
        viewGivers = PROG.view_givers || [];
    const { plinths, got: acquired } = model.treasures;
    return [
        ...model.gates.map((fi) => gateOverlay(context, fi)),
        ...model.signs.map((si) => signOverlay(context, si)),
        ...model.pads.map((ti) => padOverlay(context, ti)),
        ...model.rooms.map((room) => goldRoomOverlay(context, room)),
        ...model.logs.map((i) => voiceLogOverlay(context, voiceLogs[i])),
        ...model.maps.map((i) => mapScrollOverlay(context, viewGivers[i])),
        ...plinths.map((plinth) => treasureOverlay(plinth, acquired)),
    ];
}
