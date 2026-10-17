// What the map draws for the progress view: the level markers by state or role, the towers, the area labels, the
// overlays (Freezers, signs, pads, gold rooms, voice logs, map scrolls, treasures) and the key
// (VIEWER.md "The page (viewer)", "The spoiler model (viewer)")
import { PROG } from '../data.ts';
import { escapeHtml } from '../util.ts';
import {
    achievementIcon,
    OVERLAY_PATHS,
    ringIcon,
    ROLE_SHAPES,
    ROLES,
    shapeIcon,
    starIcon,
    STATE_COLORS,
    towerIcon,
} from '../map/icons.ts';
import type { Role, ShapeName } from '../map/icons.ts';
import type { MapFreezer, MapLabel, MapMarker, MapOverlay, MapTower, MarkerStyle } from '../map/map-view.ts';
import { achievementName } from '../model/achievements.ts';
import { areaName } from '../model/areas.ts';
import { capitalized, freezerNoun } from '../model/freezer-names.ts';
import { roleFor } from '../model/goal-roles.ts';
import { FOG_LAYER_KEYS, layerName, mapLayerOf } from '../model/layers.ts';
import { stateLabel } from '../model/progress.ts';
import { towerName } from '../model/towers.ts';
import { signStateOf } from '../model/unlocking.ts';
import type { Area, GoldRoom, TreasureDisplay, ViewGiver, VoiceLog } from '../types.ts';
import type { PanelContext } from './context.ts';
import { FOG_TEXT, gateMode, signNeed, signText, stateDot, towerNameHtml } from './plan-chips.ts';

/** How a level marker takes its colour: by its state, or by its role for the goal. */
type MarkerColor =
    | { source: 'state'; state: 'solved' | 'locked' | 'blocked' | 'unlocked' }
    | { source: 'role'; role: Role };

const isRole = (name: string): name is Role => name in ROLES;

// Which overlay markers the map draws: what is left to do for the goal. Freezers that are open or that the goal does
// not need, signs satisfied, and teleporters, gold rooms, logs, map scrolls and treasures found are left out, unless
// the Solved chip asks for what is done.
export const markerShown = (overlay: MapOverlay, solvedShown: boolean): boolean =>
    solvedShown || (!overlay.done && overlay.req !== false);

// the order markers are drawn in: solved, then the ones coloured by state (locked, blocked), then playable ones, then
// playable ones on the goal's cheapest plans, then the level the save is in
function drawRank(solved: boolean, stateColored: boolean, onPlan: boolean | undefined, current: boolean): number {
    if (current) return 4;
    if (solved) return 0;
    if (stateColored) return 1;
    if (onPlan) return 3;
    return 2;
}

// solved, locked and blocked levels by state; playable ones by their role for the goal, with a ring once entered
function colorOf(context: PanelContext, levelIndex: number): MarkerColor {
    const levelState = context.progress.state[levelIndex];
    if (levelState === 'solved' || levelState === 'locked' || levelState === 'blocked') {
        return { source: 'state', state: levelState };
    }

    const role = context.entries.get(levelIndex)?.role;
    if (role) return { source: 'role', role };
    return { source: 'state', state: 'unlocked' };
}

// the key item that stands for a marker colour
function colorKeyOf(markerColor: MarkerColor): string {
    if (markerColor.source === 'role') return `role:${markerColor.role}`;
    return `state:${markerColor.state}`;
}

// what a level's role for the goal says in its tooltip
function roleTip(context: PanelContext, levelIndex: number): string {
    const role = context.entries.get(levelIndex)?.role;
    if (!role) return '';
    return ` · ${ROLES[role][0]}`;
}

const KEY_ITEMS: Array<[colorKey: string, label: string, color: string]> = [
    ['state:solved', 'Solved', STATE_COLORS.solved],
    ...Object.entries(ROLES).map(([role, [label, color]]): [string, string, string] => [`role:${role}`, label, color]),
    ['state:unlocked', 'Reachable', STATE_COLORS.unlocked],
    ['state:blocked', 'Blocked', STATE_COLORS.blocked],
    ['state:locked', 'Locked', STATE_COLORS.locked],
];

function keyIcon(colorKey: string, color: string): string {
    if (colorKey === 'state:solved') return starIcon(color);
    if (colorKey.startsWith('role:')) {
        const role = colorKey.slice('role:'.length);
        if (isRole(role)) return shapeIcon(ROLE_SHAPES[role], color);
    }

    return shapeIcon('circle', color);
}

// the key lists only the colours of markers the current filter draws on the map's layer
export function keyHtml(context: PanelContext): string {
    if (!context.goalIds.some((levelIndex) => context.match(levelIndex))) {
        if (context.narrowed()) {
            return '<span class="none">No levels match</span><button data-clear>Clear filters</button>';
        }
        return '';
    }

    const shown = context.goalIds.filter((levelIndex) => context.match(levelIndex) && context.inView(levelIndex));
    if (!shown.length) return '';

    const used = new Set(shown.map((levelIndex) => colorKeyOf(colorOf(context, levelIndex))));
    let html = KEY_ITEMS.filter(([colorKey]) => used.has(colorKey))
        .map(([colorKey, label, color]) => `<span>${keyIcon(colorKey, color)}${label}</span>`)
        .join('');

    if (shown.some((levelIndex) => context.started(levelIndex))) html += `<span>${ringIcon}Entered</span>`;
    if (shown.some((levelIndex) => context.towerShown(levelIndex))) html += `<span>${towerIcon}Tower level</span>`;
    if (shown.some((levelIndex) => context.levels[levelIndex].a)) html += `<span>${achievementIcon}Achievement</span>`;
    return html;
}

// a level marker per level; a fogged tower stays unnamed on the levels it owns
export function levelMarkers(context: PanelContext): MapMarker[] {
    const progress = context.progress;
    return context.levels.map((level, levelIndex): MapMarker => {
        let tower = '';
        if (context.towerShown(levelIndex)) {
            let dropdown = '';
            if (level.d) dropdown = ' · dropdown';
            tower = `<br>${escapeHtml(towerName(level.t ?? 0))}${dropdown}`;
        }

        const freezerIndex = context.iceOf[levelIndex];
        let ice: MapFreezer | undefined;
        if (freezerIndex !== undefined) ice = { id: 'g' + freezerIndex, open: progress.gateOpen[freezerIndex] };

        return {
            levelIndex,
            x: level.p[0],
            y: level.p[1],
            z: level.p[2],
            ice,
            get tip() {
                let achievement = '';
                if (level.a) achievement = `<br>${escapeHtml(achievementName(level.a))}`;

                let gate = '';
                if (freezerIndex !== undefined) {
                    let openness = 'Closed';
                    if (progress.gateOpen[freezerIndex]) openness = 'Open';
                    gate = `<br>In an ${freezerNoun(freezerIndex)} · ${openness}`;
                }

                const name = escapeHtml(level.n);
                const state = stateLabel(progress, progress.state[levelIndex]);
                const role = roleTip(context, levelIndex);
                return `<b>${name}</b><br>${state}${role}${tower}${achievement}${gate}`;
            },
        };
    });
}

export function towerMarkers(context: PanelContext): MapTower[] {
    const progress = context.progress;
    return progress.towers
        .map((tower, towerIndex): MapTower => {
            let activated = '';
            if (tower.active) activated = ' · activated';

            const name = escapeHtml(towerName(tower.t));
            return {
                towerIndex,
                x: tower.p[0],
                y: tower.p[1],
                z: tower.p[2],
                activated: tower.active,
                tip: `<b>${name}</b><br>${tower.solvedNormal} / ${tower.req} solved${activated}`,
            };
        })
        .filter((tower) => !progress.towerHidden[tower.towerIndex]);
}

/** An area with the number of levels that name it. */
interface SizedArea {
    area: Area;
    levelCount: number;
    areaIndex: number;
}

// the names of the areas shown; bigger areas first, so they keep their label when labels crowd
export function areaLabels(context: PanelContext): MapLabel[] {
    const model = context.model;
    const sizes = context.areas.map(() => 0);
    model.levelArea.forEach((area) => {
        if (area != null) sizes[area]++;
    });

    return context.areas
        .map((area, areaIndex): SizedArea => ({ area, levelCount: sizes[areaIndex], areaIndex }))
        .filter(
            ({ area, areaIndex }) =>
                area.p && model.areaShown(areaIndex) && model.shownAt(mapLayerOf(area.p[2]), area.p),
        )
        .toSorted((first, second) => second.levelCount - first.levelCount)
        .map(({ area }): MapLabel => ({ x: area.p[0], y: area.p[1], z: area.p[2], text: areaName(area) }));
}

// how a level marker is drawn: hidden when the filter leaves it out, its colour, shape and rank
export function markerStyle(context: PanelContext, marker: MapMarker): MarkerStyle {
    const levelIndex = marker.levelIndex;
    const progress = context.progress;
    const markerColor = colorOf(context, levelIndex);
    const current = levelIndex === context.model.inLevel;
    const solved = progress.state[levelIndex] === 'solved';
    const stateColored = markerColor.source === 'state';
    const rank = drawRank(solved, stateColored, context.entries.get(levelIndex)?.onPlan, current);

    let color: string;
    let shape: ShapeName;
    if (markerColor.source === 'state') {
        color = STATE_COLORS[markerColor.state];
        shape = 'circle';
    } else {
        color = ROLES[markerColor.role][1];
        shape = ROLE_SHAPES[markerColor.role];
    }

    return {
        hidden: !context.match(levelIndex),
        gone: progress.hidden[levelIndex],
        color,
        star: solved,
        shape,
        ring: context.started(levelIndex),
        big: context.towerShown(levelIndex),
        achievement: !!context.levels[levelIndex].a,
        current,
        rank,
    };
}

function levelNameHtml(context: PanelContext, levelIndex: number): string {
    if (context.progress.hidden[levelIndex]) return FOG_TEXT;
    return stateDot(context.progress.state[levelIndex]) + escapeHtml(context.levels[levelIndex].n);
}

// overlays: Freezers, signs, MAJOR world pads, gold rooms at their hub endpoints, voice logs, map scrolls, treasure
// plinths; none under fog while it hides things
function gateOverlay(context: PanelContext, freezerIndex: number): MapOverlay {
    const progress = context.progress;
    const freezer = context.freezers[freezerIndex];
    const isOpen = progress.gateOpen[freezerIndex];

    // levels behind the gate that fog hides are left out of the count, not out of Next steps
    const leads = progress.reach?.leads.get(freezerIndex)?.filter((level) => !progress.hidden[level]).length;

    const mode = gateMode(freezer);
    const options = [
        ...freezer.req.map((level) => levelNameHtml(context, level)),
        ...(freezer.signs || []).map((sign) => signText(context, sign)),
    ];
    let withMode = '';
    if (mode) withMode = ' ' + mode;
    const needs = `Opens with${withMode}<br>${options.join('<br>')}`;

    const area = context.gateArea(freezerIndex);
    let inArea = '';
    if (area != null) inArea = ` · ${escapeHtml(area)}`;

    let tip = `<b>${capitalized(freezerNoun(freezerIndex))}</b>${inArea}<br>`;
    if (isOpen) {
        tip += 'Open';
    } else {
        tip += `Closed<hr>${needs}`;
        if (leads) {
            let plural = '';
            if (leads > 1) plural = 's';
            tip += `<hr><span class="muted">Leads to ${leads} level${plural} not reached (approx.)</span>`;
        }
    }

    let className = 'gt';
    if (isOpen) className += ' open';
    return {
        id: 'g' + freezerIndex,
        attr: ['data-gate', freezerIndex],
        merge: context.iceLevel.get(freezerIndex),
        kind: 'gates',
        done: isOpen,
        req: roleFor(context.goal, 'g', freezerIndex) !== 'optional',
        layer: FOG_LAYER_KEYS[freezer.l],
        x: freezer.p[0],
        y: freezer.p[1],
        cls: className,
        d: OVERLAY_PATHS.gate,
        tip,
    };
}

// signs that open gates open their panel; a tower status sign opens its tower's
function signOverlay(context: PanelContext, signIndex: number): MapOverlay {
    const sign = context.signs[signIndex];
    // a tower status sign is never read: it counts as done once its tower is active
    let signState = signStateOf(context.progress, sign);
    if (sign.status && signState === 'ready') signState = 'read';

    let attr: [name: string, value: number] = ['data-sign', signIndex];
    let status = 'Not yet';
    if (signState === 'read') status = 'Satisfied';
    if (signState === 'ready') status = 'Ready to read';
    let tip = `<b>Sign</b><br>${signNeed(context, sign)}<br>${status}`;
    if (sign.status && sign.tower !== undefined) {
        const tower = context.progress.towers[sign.tower];
        let activated = '';
        if (tower.active) activated = ' · activated';
        const towerHtml = towerNameHtml(context, sign.tower);
        tip = `<b>Tower sign</b><br>${towerHtml}<br>${tower.solvedNormal} / ${tower.req} solved${activated}`;
        attr = ['data-gtw', sign.tower];
    }

    let className = 'sg';
    if (sign.status) className += ' status';
    if (signState === 'read') className += ' ok';
    if (signState === 'ready') className += ' ready';
    return {
        id: 's' + signIndex,
        attr,
        kind: 'gates',
        done: signState === 'read',
        layer: FOG_LAYER_KEYS[sign.l],
        x: sign.p[0],
        y: sign.p[1],
        cls: className,
        d: OVERLAY_PATHS.sign,
        tip,
    };
}

// world pads only; their twins sit in the map rooms
function padOverlay(context: PanelContext, teleporterIndex: number): MapOverlay {
    const pad = context.teleporters[teleporterIndex];
    const discovered = context.model.padDisc(teleporterIndex);
    let status = 'Not discovered';
    let className = 'tp off';
    if (discovered) {
        status = 'Discovered';
        className = 'tp';
    }

    let disabled = ' · disabled';
    if (context.progress.tst[teleporterIndex].en) disabled = '';
    return {
        kind: 'tps',
        layer: FOG_LAYER_KEYS[pad.l],
        x: pad.p[0],
        y: pad.p[1],
        done: discovered,
        cls: className,
        d: OVERLAY_PATHS.tp,
        tip: `<b>Teleporter</b><br>${status}${disabled}`,
    };
}

// a gold room is visited once its endpoint is discovered, and open once its tower is activated
function goldRoomState(context: PanelContext, room: GoldRoom): [roomClass: string, label: string] {
    const states = context.progress.tst;
    if (states[room.endpoint].disc) return ['done', 'Visited'];

    const tower = context.progress.towers[room.tower];
    if (tower?.active || states[room.pad]?.en || states[room.endpoint].en) return ['unl', 'Open, not visited'];
    return ['', 'Locked'];
}

function goldRoomOverlay(context: PanelContext, room: GoldRoom): MapOverlay {
    const progress = context.progress;
    const endpoint = context.teleporters[room.endpoint];
    const tower = progress.towers[room.tower];
    const [roomClass, label] = goldRoomState(context, room);
    let attr: [name: string, value: number] | undefined;
    if (tower && !progress.towerHidden[room.tower]) attr = ['data-gtw', room.tower];

    let towerLine = '';
    if (tower) {
        let activated = '';
        if (tower.active) activated = ' · activated';
        towerLine = `<br>${towerNameHtml(context, room.tower)}${activated}`;
    }

    return {
        kind: 'tps',
        layer: FOG_LAYER_KEYS[endpoint.l],
        x: endpoint.p[0],
        y: endpoint.p[1],
        done: progress.tst[room.endpoint].disc,
        cls: 'gr ' + roomClass,
        d: OVERLAY_PATHS.gold,
        attr,
        tip: `<b>Antipode teleporter</b><br>${label}${towerLine}`,
    };
}

function voiceLogOverlay(context: PanelContext, log: VoiceLog): MapOverlay {
    const heard = context.model.heard(log);
    let status = 'Not heard';
    let className = 'vl off';
    if (heard) {
        status = 'Heard';
        className = 'vl';
    }

    return {
        kind: 'logs',
        layer: FOG_LAYER_KEYS[log.l],
        x: log.p[0],
        y: log.p[1],
        done: heard,
        cls: className,
        d: OVERLAY_PATHS.log,
        tip: `<b>Voice log</b><br>${status}`,
    };
}

function mapScrollOverlay(context: PanelContext, giver: ViewGiver): MapOverlay {
    const taken = context.model.taken(giver);
    let status = 'Not taken';
    let className = 'vg off';
    if (taken) {
        status = 'Taken';
        className = 'vg';
    }

    return {
        kind: 'maps',
        layer: FOG_LAYER_KEYS[giver.l],
        x: giver.p[0],
        y: giver.p[1],
        done: taken,
        cls: className,
        d: OVERLAY_PATHS.map,
        tip: `<b>Map scroll</b><br>${escapeHtml(layerName(FOG_LAYER_KEYS[giver.l]))} · ${status}`,
    };
}

function treasureOverlay(plinth: TreasureDisplay, acquired: number): MapOverlay {
    const got = acquired > plinth.i;
    let status = 'Empty';
    let className = 'tr off';
    if (got) {
        status = 'Acquired';
        className = 'tr';
    }

    return {
        kind: 'treasures',
        layer: mapLayerOf(plinth.p[2]),
        x: plinth.p[0],
        y: plinth.p[1],
        done: got,
        cls: className,
        d: OVERLAY_PATHS.treasure,
        tip: `<b>Treasure plinth ${plinth.i + 1}</b><br>${status}`,
    };
}

export function overlaysOf(context: PanelContext): MapOverlay[] {
    const model = context.model;
    const voiceLogs = PROG.voice_logs || [];
    const viewGivers = PROG.view_givers || [];
    const { plinths, got: acquired } = model.treasures;
    return [
        ...model.gates.map((freezerIndex) => gateOverlay(context, freezerIndex)),
        ...model.signs.map((signIndex) => signOverlay(context, signIndex)),
        ...model.pads.map((teleporterIndex) => padOverlay(context, teleporterIndex)),
        ...model.rooms.map((room) => goldRoomOverlay(context, room)),
        ...model.logs.map((log) => voiceLogOverlay(context, voiceLogs[log])),
        ...model.maps.map((giver) => mapScrollOverlay(context, viewGivers[giver])),
        ...plinths.map((plinth) => treasureOverlay(plinth, acquired)),
    ];
}
