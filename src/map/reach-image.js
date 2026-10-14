// The Reachable overlay image of one map layer, from the walk's reached columns (VIEWER.md "Seeds and the reached
// cells"), and the fogged rectangles it hatches
import { PROG } from '../data.js';
import { mapCol } from '../walk/cells.js';
import { INK_RGB, REACH_EDGE_RGB, REACH_RGB } from './colors.js';
import { imageUrl, MAP_SCALE, pixelOffset, putPx } from './layer-image.js';

// the alpha of a reached square's wash, of its edge line and of an unreached square's dimming
const REACH_FILL = 0.32,
    REACH_EDGE = 0.8,
    REACH_DIM = 0.18;
// per square of the overlay: left out (fogged), reached, dimmed
const LEFT_OUT = 0,
    REACHED = 1,
    DIMMED = 2;
// a pixel's colour and alpha byte: the edge line, a reached square's wash or an unreached square's dimming
const EDGE_PIXEL = [REACH_EDGE_RGB, Math.round(255 * REACH_EDGE)],
    REACHED_PIXEL = [REACH_RGB, Math.round(255 * REACH_FILL)],
    DIMMED_PIXEL = [INK_RGB, Math.round(255 * REACH_DIM)];
function reachPixel(onEdge, kind) {
    if (onEdge) return EDGE_PIXEL;
    if (kind === REACHED) return REACHED_PIXEL;
    return DIMMED_PIXEL;
}
// The Reachable overlay of one layer, MAP_SCALE pixels per square: squares where cols[layer.key], a column bitmap from
// reachability(), is set get a light --reach wash with a soft --reach-edge line inside them along the sides that face
// unreached squares; every other square is dimmed a little. With fog given, fogged squares are left out, so the image
// holds nothing the fog hides. null when no square is reached.
export function reachImage(layer, cols, fog) {
    const reachedColumns = cols[layer.key],
        [width, height] = PROG.map.size,
        [cornerX, cornerY] = PROG.map.corner;
    const kinds = new Uint8Array(width * height);
    let any = false;
    for (let j = 0; j < height; j++)
        for (let i = 0; i < width; i++) {
            if (fog?.cover(layer.key, cornerX + i, cornerY + height - 1 - j)) continue;
            kinds[j * width + i] = reachedColumns[j * width + i] ? REACHED : DIMMED;
            if (reachedColumns[j * width + i]) any = true;
        }
    if (!any) return null;
    const reached = (i, j) => i >= 0 && j >= 0 && i < width && j < height && kinds[j * width + i] === REACHED;
    return imageUrl((pixels) => {
        for (let j = 0; j < height; j++)
            for (let i = 0; i < width; i++) {
                const kind = kinds[j * width + i];
                if (kind === LEFT_OUT) continue;
                // per side (west, east, north, south): whether a reached square faces an unreached one there
                let edges = [];
                if (kind === REACHED)
                    edges = [!reached(i - 1, j), !reached(i + 1, j), !reached(i, j - 1), !reached(i, j + 1)];
                for (let y = 0; y < MAP_SCALE; y++)
                    for (let x = 0; x < MAP_SCALE; x++) {
                        const onEdge =
                            (edges[0] && !x) ||
                            (edges[1] && x === MAP_SCALE - 1) ||
                            (edges[2] && !y) ||
                            (edges[3] && y === MAP_SCALE - 1);
                        const [color, alpha] = reachPixel(onEdge, kind);
                        putPx(pixels, pixelOffset(width, i, j, x, y), color, alpha);
                    }
            }
    });
}
// the fogged rectangles (world [x, y, w, h], from fog.rects()) holding a square whose column is set in cols, a column
// bitmap from reachability() taken before any fog is applied
export function reachedRects(cols, rects) {
    if (!cols) return [];
    return rects.filter(([x, y, width, height]) => {
        for (let squareY = Math.ceil(y); squareY < y + height; squareY++)
            for (let squareX = Math.ceil(x); squareX < x + width; squareX++)
                if (cols[mapCol(squareX, squareY)]) return true;
        return false;
    });
}
