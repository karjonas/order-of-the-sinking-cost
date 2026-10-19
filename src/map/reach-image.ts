// The Reachable overlay image of one map layer, from the walk's reached columns (VIEWER.md "Seeds and the reached
// cells"), and the fogged rectangles it hatches
import { PROG } from '../data.ts';
import type { Fog, FogRect } from '../fog.ts';
import type { MapLayer } from '../types.ts';
import { mapCol } from '../walk/cells.ts';
import { INK_RGB, REACH_EDGE_RGB, REACH_RGB } from './colors.ts';
import type { Rgb } from './colors.ts';

/** A pixel's colour and alpha byte. */
type ReachPixel = [color: Rgb, alpha: number];

/** The Reachable images are painted MAP_SCALE pixels per square, so they stay crisp when zoomed. */
const MAP_SCALE = 4;

/** A data URL of a map-sized image (MAP_SCALE pixels per square) whose RGBA bytes fill(pixels) writes. */
function imageUrl(fill: (pixels: Uint8ClampedArray) => void): string {
    const [width, height] = PROG.map.size;
    const canvas = document.createElement('canvas');
    canvas.width = width * MAP_SCALE;
    canvas.height = height * MAP_SCALE;

    const context = canvas.getContext('2d')!;
    const image = context.createImageData(canvas.width, canvas.height);
    fill(image.data);
    context.putImageData(image, 0, 0);
    return canvas.toDataURL();
}

/** Writes a colour (and alpha) to the pixel at a byte offset of image data. */
const putPixel = (pixels: Uint8ClampedArray, offset: number, color: Rgb, alpha: number): void => {
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = alpha;
};

/** The byte offset of pixel (x, y) of square (i, j) in an image of a map width squares wide. */
const pixelOffset = (width: number, i: number, j: number, x: number, y: number): number =>
    ((j * MAP_SCALE + y) * width * MAP_SCALE + i * MAP_SCALE + x) * 4;

// the alpha of a reached square's wash, of its edge line and of an unreached square's dimming
const REACH_FILL = 0.32;

const REACH_EDGE = 0.8;
const REACH_DIM = 0.18;

// per square of the overlay: left out (fogged), reached, dimmed
const LEFT_OUT = 0;

const REACHED = 1;
const DIMMED = 2;

// a pixel's colour and alpha byte: the edge line, a reached square's wash or an unreached square's dimming
const EDGE_PIXEL: ReachPixel = [REACH_EDGE_RGB, Math.round(255 * REACH_EDGE)];

const REACHED_PIXEL: ReachPixel = [REACH_RGB, Math.round(255 * REACH_FILL)];
const DIMMED_PIXEL: ReachPixel = [INK_RGB, Math.round(255 * REACH_DIM)];

function reachPixel(onEdge: boolean, kind: number): ReachPixel {
    if (onEdge) return EDGE_PIXEL;
    if (kind === REACHED) return REACHED_PIXEL;
    return DIMMED_PIXEL;
}

/**
 * The Reachable overlay of one layer, MAP_SCALE pixels per square: squares where cols[layer.key], a column bitmap from
 * reachability(), is set get a light --reach wash with a soft --reach-edge line inside them along the sides that face
 * unreached squares; every other square is dimmed a little. With fog given, fogged squares are left out, so the image
 * holds nothing the fog hides. null when no square is reached.
 */
export function reachImage(layer: MapLayer, cols: Record<string, Uint8Array>, fog?: Fog | null): string | null {
    const reachedColumns = cols[layer.key];
    const [width, height] = PROG.map.size;
    const [cornerX, cornerY] = PROG.map.corner;
    const kinds = new Uint8Array(width * height);
    let anyReached = false;

    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            if (fog?.cover(layer.key, cornerX + i, cornerY + height - 1 - j)) continue;

            const square = j * width + i;
            if (reachedColumns[square]) {
                kinds[square] = REACHED;
                anyReached = true;
            } else {
                kinds[square] = DIMMED;
            }
        }
    }

    if (!anyReached) return null;

    const reached = (i: number, j: number): boolean =>
        i >= 0 && j >= 0 && i < width && j < height && kinds[j * width + i] === REACHED;

    return imageUrl((pixels) => {
        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                const kind = kinds[j * width + i];
                if (kind === LEFT_OUT) continue;

                // per side (west, east, north, south): whether a reached square faces an unreached one there
                let edges = [false, false, false, false];
                if (kind === REACHED) {
                    edges = [!reached(i - 1, j), !reached(i + 1, j), !reached(i, j - 1), !reached(i, j + 1)];
                }

                for (let y = 0; y < MAP_SCALE; y++) {
                    for (let x = 0; x < MAP_SCALE; x++) {
                        const onWest = edges[0] && x === 0;
                        const onEast = edges[1] && x === MAP_SCALE - 1;
                        const onNorth = edges[2] && y === 0;
                        const onSouth = edges[3] && y === MAP_SCALE - 1;
                        const [color, alpha] = reachPixel(onWest || onEast || onNorth || onSouth, kind);
                        putPixel(pixels, pixelOffset(width, i, j, x, y), color, alpha);
                    }
                }
            }
        }
    });
}

/**
 * The fogged rectangles (world [x, y, w, h], from fog.rects()) holding a square whose column is set in cols, a column
 * bitmap from reachability() taken before any fog is applied.
 */
export function reachedRects(cols: Uint8Array | null | undefined, rects: FogRect[]): FogRect[] {
    if (!cols) return [];

    return rects.filter(([x, y, width, height]) => {
        for (let squareY = Math.ceil(y); squareY < y + height; squareY++) {
            for (let squareX = Math.ceil(x); squareX < x + width; squareX++) {
                if (cols[mapCol(squareX, squareY)]) return true;
            }
        }
        return false;
    });
}
