// Why the walk calls a level unreachable: the closed gates in front of it, the layer it is on, and the mechanics the
// walk does not model near the way in, named while spoilers show or once the save has met them (their world's
// achievement) (VIEWER.md "Pockets, leads and why", "The spoiler model (viewer)")
import { hasAchievement } from '../model/achievements.js';
import { layerName } from '../model/layers.js';

const MECHANICS = {
    dragon: ['HEROES', 'dragon fire'],
    beam: ['PROMISE', 'Beamcaster beams'],
    mirror: ['MIRRORS', 'mirrors'],
    stones: ['SKIPPING', 'skipping stones'],
};

// a level's way-in gates that fog does not hide
export function wayIn(context, i) {
    const gates = context.progress.wayIn?.[i] || [];
    return gates.filter((fi) => context.gateShown(context.freezers[fi]));
}
// " · <area>" after a gate's text while the gate's area is shown
function gateAreaSuffix(context, fi) {
    const area = context.gateArea(fi);
    if (area == null) return '';
    return ' · ' + area;
}
function gateText(context, i, gates) {
    if (!gates.length) return '';
    const ice = context.iceOf[i];
    if (gates.includes(ice)) return `in an ice gate${gateAreaSuffix(context, ice)}`;
    if (gates.length > 1) return `behind one of ${gates.length} ice gates`;
    return `behind ice gate${gateAreaSuffix(context, gates[0])}`;
}
function mechanicsText(context, mechanics) {
    if (!mechanics.length) return '';
    const known = mechanics.filter((key) => !context.hide || hasAchievement(context.status, MECHANICS[key][0]));
    if (!known.length) return 'may need something the map does not model';
    return `may need ${known.map((key) => MECHANICS[key][1]).join(' / ')}`;
}
export function whyParts(context, i) {
    const progress = context.progress;
    const why = progress.why?.[i] || { mech: [] };
    const layer = progress.access?.[i];
    // a layer the walk has not reached, named once its way onto it shows as a plan step
    let layerText = '';
    if (layer && context.model.stepShown({ t: 'a', id: layer }))
        layerText = `needs the way onto the ${layerName(layer)}`;
    return {
        gate: gateText(context, i, wayIn(context, i)),
        mech: mechanicsText(context, why.mech),
        layer: layerText,
        none: !progress.wayIn?.[i]?.length && !why.mech.length && !layer,
    };
}
export function approxTip(context) {
    let leftOut = 'mirrors, vertical Beamcaster beams and dragon fire';
    if (context.hide) leftOut = 'some mechanics';
    return `Approximate: the walk model leaves out ${leftOut}`;
}
export function whyText(context, i) {
    const parts = whyParts(context, i);
    const text = [parts.gate, parts.mech, parts.layer].filter(Boolean).join(' · ');
    if (text) return text;
    if (parts.none) return 'no known route';
    return 'not reachable from where you have been';
}
