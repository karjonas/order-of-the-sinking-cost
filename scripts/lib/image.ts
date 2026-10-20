// Scaling of RGBA images

// How much of the source pixel `index` lies in the span [from, to) of source coordinates
function overlap(index: number, from: number, to: number): number {
    return Math.max(0, Math.min(index + 1, to) - Math.max(index, from));
}

/**
 * The image scaled down to fit a size x size square, centred and keeping its aspect, as straight RGBA with a
 * transparent border. Each output pixel is the exact area average of the source pixels it covers, taken on premultiplied
 * colours so the transparent edges do not bleed their colour in.
 */
export function fitSquare(rgba: Uint8ClampedArray, width: number, height: number, size: number): Uint8Array {
    const scale = Math.max(width, height) / size;
    const fittedWidth = Math.max(1, Math.round(width / scale));
    const fittedHeight = Math.max(1, Math.round(height / scale));
    const left = Math.floor((size - fittedWidth) / 2);
    const top = Math.floor((size - fittedHeight) / 2);
    const out = new Uint8Array(size * size * 4);

    for (let y = 0; y < fittedHeight; y++) {
        const fromY = (y * height) / fittedHeight;
        const toY = ((y + 1) * height) / fittedHeight;
        for (let x = 0; x < fittedWidth; x++) {
            const fromX = (x * width) / fittedWidth;
            const toX = ((x + 1) * width) / fittedWidth;
            let red = 0;
            let green = 0;
            let blue = 0;
            let alpha = 0;
            let weightSum = 0;
            for (let sy = Math.floor(fromY); sy < Math.ceil(toY); sy++) {
                const weightY = overlap(sy, fromY, toY);
                for (let sx = Math.floor(fromX); sx < Math.ceil(toX); sx++) {
                    const weight = weightY * overlap(sx, fromX, toX);
                    const at = (sy * width + sx) * 4;
                    const coverage = (rgba[at + 3] / 255) * weight;
                    red += rgba[at] * coverage;
                    green += rgba[at + 1] * coverage;
                    blue += rgba[at + 2] * coverage;
                    alpha += coverage;
                    weightSum += weight;
                }
            }
            const target = ((top + y) * size + left + x) * 4;
            if (alpha > 0) {
                out[target] = Math.round(red / alpha);
                out[target + 1] = Math.round(green / alpha);
                out[target + 2] = Math.round(blue / alpha);
            }
            out[target + 3] = Math.round((alpha / weightSum) * 255);
        }
    }
    return out;
}
