// Colours of the Reachable overlay: the page's colour tokens as RGB

/** Red, green and blue bytes. */
export type Rgb = [red: number, green: number, blue: number];

// a colour token of the page (#rrggbb) as [r, g, b]
function tokenRgb(name: string): Rgb {
    const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const [red, green, blue] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
    return [red, green, blue];
}

export const REACH_RGB = tokenRgb('--reach');
export const INK_RGB = tokenRgb('--ink');
export const REACH_EDGE_RGB = tokenRgb('--reach-edge');
