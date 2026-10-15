// The why text of a level the walk cannot reach, on a stub context
import { expect, test, vi } from 'vitest';
import { whyText } from '../src/panels/why.ts';

vi.mock('../src/data.ts', async () => {
    const SCHEMA = (await import('../data/schema.json')).default;
    return { SCHEMA, PROG: { levels: [], freezers: [] }, WORLD: {}, worldReady: Promise.resolve() };
});

// one blocked level with no way-in gate, no mechanic and no access mark; skyShown: whether fog shows the sky
function context(fromSky, skyShown) {
    return {
        progress: { wayIn: [[]], why: [{ mech: [] }], access: [null], reach: { fromSky: [fromSky ? 1 : 0] } },
        model: { stepShown: (node) => node.t !== 'a' || node.id !== 'sky' || skyShown },
        hide: true,
        iceOf: [],
        freezers: [],
        gateShown: () => true,
    };
}

test('a pocket entered only by a drop from a sky ledge is "from the Sky" once the sky shows', () => {
    expect(whyText(context(true, true), 0)).toBe('from the Sky');
});
test('under fog it stays "no known route"', () => {
    expect(whyText(context(true, false), 0)).toBe('no known route');
});
test('a pocket with no way in at all has "no known route"', () => {
    expect(whyText(context(false, true), 0)).toBe('no known route');
});
