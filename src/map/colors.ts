// Colours of the map images: the page's colour tokens as RGB, and sRGB <-> OKLab (DATAFILES.md "The viewer's base
// image")

/** Red, green and blue bytes. */
export type Rgb = [red: number, green: number, blue: number];

// a colour token of the page (#rrggbb) as [r, g, b]
function tokenRgb(name: string): Rgb {
    const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const [red, green, blue] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
    return [red, green, blue];
}

export const FOG_RGB = tokenRgb('--fog');
export const REACH_RGB = tokenRgb('--reach');
export const INK_RGB = tokenRgb('--ink');
export const REACH_EDGE_RGB = tokenRgb('--reach-edge');

// an sRGB byte as linear light
function toLinear(byte: number): number {
    const value = byte / 255;
    if (value <= 0.04045) return value / 12.92;
    return ((value + 0.055) / 1.055) ** 2.4;
}

// linear light as an sRGB byte, clamped
function toByte(linear: number): number {
    const value = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.round(255 * Math.min(1, Math.max(0, value)));
}

/** The OKLab colour of an sRGB colour, through the long, medium and short cone responses of the model. */
export function oklab(
    red: number,
    green: number,
    blue: number,
): [lightness: number, greenRed: number, blueYellow: number] {
    const linearRed = toLinear(red);
    const linearGreen = toLinear(green);
    const linearBlue = toLinear(blue);
    const long = Math.cbrt(0.4122214708 * linearRed + 0.5363325363 * linearGreen + 0.0514459929 * linearBlue);
    const medium = Math.cbrt(0.2119034982 * linearRed + 0.6806995451 * linearGreen + 0.1073969566 * linearBlue);
    const short = Math.cbrt(0.0883024619 * linearRed + 0.2817188376 * linearGreen + 0.6299787005 * linearBlue);
    return [
        0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
        1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
        0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
    ];
}

/** The sRGB colour of an OKLab colour, clamped to bytes. */
export function oklabRgb(lightness: number, greenRed: number, blueYellow: number): Rgb {
    const long = (lightness + 0.3963377774 * greenRed + 0.2158037573 * blueYellow) ** 3;
    const medium = (lightness - 0.1055613458 * greenRed - 0.0638541728 * blueYellow) ** 3;
    const short = (lightness - 0.0894841775 * greenRed - 1.291485548 * blueYellow) ** 3;
    return [
        toByte(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
        toByte(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
        toByte(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
    ];
}
