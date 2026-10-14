// Colours of the map images: the page's colour tokens as RGB, and sRGB <-> OKLab (DATAFILES.md "The viewer's base
// image")
// a colour token of the page (#rrggbb) as [r, g, b]
function tokenRgb(name) {
    const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
}
export const FOG_RGB = tokenRgb('--fog');
export const REACH_RGB = tokenRgb('--reach');
export const INK_RGB = tokenRgb('--ink');
export const REACH_EDGE_RGB = tokenRgb('--reach-edge');

// an sRGB byte as linear light
function toLinear(byte) {
    const value = byte / 255;
    if (value <= 0.04045) return value / 12.92;
    return ((value + 0.055) / 1.055) ** 2.4;
}
// linear light as an sRGB byte, clamped
function toByte(linear) {
    const value = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.round(255 * Math.min(1, Math.max(0, value)));
}
// l, m, s: the cone responses of the OKLab model
export function oklab(red, green, blue) {
    const r = toLinear(red),
        g = toLinear(green),
        b = toLinear(blue);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
        m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
        s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
}
export function oklabRgb(lightness, a, b) {
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3,
        m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3,
        s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
        toByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        toByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        toByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
}
