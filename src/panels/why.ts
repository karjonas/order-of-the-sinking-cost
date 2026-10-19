// Why the walk calls a level unreachable: the closed gates in front of it, the layer it is on, and the mechanics the
// walk does not model near the way in, named while spoilers show or once the save has met them (their world's
// achievement) (VIEWER.md "Pockets, leads and why", "The spoiler model (viewer)")
import { hasAchievement } from '../model/achievements.ts';
import { freezerNoun, freezersNoun } from '../model/freezer-names.ts';
import { layerName, wayTo } from '../model/layers.ts';
import type { PanelContext } from './context.ts';

/**
 * The pieces of why a level is not reachable: its gates, the mechanics and the layer it needs, whether nothing is known
 * and whether a drop from the sky leads into it.
 */
export interface WhyParts {
    gate: string;
    mech: string;
    layer: string;
    none: boolean;
    fromSky: boolean;
}

// the world's achievement that names a mechanic, and the mechanic in the game's words (it capitalises its objects)
const MECHANICS: Record<string, [achievement: string, text: string]> = {
    dragon: ['HEROES', 'Dragon fire'],
    beam: ['PROMISE', 'Beams'],
    mirror: ['MIRRORS', 'Mirrors'],
    stones: ['SKIPPING', 'Skipping Stones'],
};

/** A level's way-in gates that fog does not hide. */
export function wayIn(context: PanelContext, levelIndex: number): number[] {
    const gates = context.progress.wayIn?.[levelIndex] || [];
    return gates.filter((freezerIndex) => context.gateShown(context.freezers[freezerIndex]));
}

// " · <area>" after a gate's text while the gate's area is shown
function gateAreaSuffix(context: PanelContext, freezerIndex: number): string {
    const area = context.gateArea(freezerIndex);
    if (area == null) return '';
    return ' · ' + area;
}

function gateText(context: PanelContext, levelIndex: number, gates: number[]): string {
    if (!gates.length) return '';

    const ice = context.iceOf[levelIndex];
    if (ice !== undefined && gates.includes(ice)) return `in an ${freezerNoun(ice)}${gateAreaSuffix(context, ice)}`;
    if (gates.length > 1) return `behind one of ${gates.length} ${freezersNoun(gates)}`;
    return `behind ${freezerNoun(gates[0])}${gateAreaSuffix(context, gates[0])}`;
}

function mechanicsText(context: PanelContext, mechanics: string[]): string {
    if (!mechanics.length) return '';

    const known = mechanics.filter((key) => !context.hide || hasAchievement(context.status, MECHANICS[key][0]));
    if (!known.length) return 'may need something the map does not model';
    return `may need ${known.map((key) => MECHANICS[key][1]).join(' / ')}`;
}

/** The pieces of why a level the walk cannot reach may still be reachable, as the panels word them. */
export function whyParts(context: PanelContext, levelIndex: number): WhyParts {
    const progress = context.progress;
    const mechanics = progress.why?.[levelIndex]?.mech ?? [];
    const layer = progress.access?.[levelIndex];

    // a layer the walk has not reached, named once its way onto it shows as a plan step
    let layerText = '';
    if (layer && context.model.stepShown({ t: 'a', id: layer })) {
        layerText = `needs ${wayTo(layer)}`;
    }

    // a drop from a sky ledge leads into the level's pocket; named once the sky shows
    const fromSky = !!progress.reach?.fromSky[levelIndex] && context.model.stepShown({ t: 'a', id: 'sky' });
    return {
        gate: gateText(context, levelIndex, wayIn(context, levelIndex)),
        mech: mechanicsText(context, mechanics),
        layer: layerText,
        none: !progress.wayIn?.[levelIndex]?.length && !mechanics.length && !layer,
        fromSky,
    };
}

/** The tooltip that says the walk model is approximate, naming what it leaves out while spoilers show. */
export function approxTip(context: PanelContext): string {
    let leftOut = 'Mirrors, vertical Beams and Dragon fire';
    if (context.hide) leftOut = 'some mechanics';
    return `Approximate: the walk model leaves out ${leftOut}`;
}

/** Why the walk calls a level unreachable, in one line. */
export function whyText(context: PanelContext, levelIndex: number): string {
    const parts = whyParts(context, levelIndex);
    const text = [parts.gate, parts.mech, parts.layer].filter(Boolean).join(' · ');
    if (text) return text;
    if (parts.none && parts.fromSky) return `from ${layerName('sky')}`;
    if (parts.none) return 'no known route';
    return 'not reachable from where you have been';
}
