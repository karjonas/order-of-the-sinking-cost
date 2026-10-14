// Map coordinates on the wrapping overworld (WORLD.md "Wrapping"): world squares to map positions, the copies of the
// map shown around the first one, and the smallest box on the torus
import { PROG } from '../data.js';
import { mod } from '../walk/cells.js';

// The overworld wraps on both axes. The terrain group and the overlay group (markers, lines, labels) are drawn once and
// use elements repeat each for two world sizes around; panzoom shows the ones the view reaches. The overlay group is
// separate so that no copy's terrain covers the overhang of a neighbouring copy's markers and labels.
const WRAP_REACH = 2;
// a map rectangle [x, y, w, h] and its copies shifted by whole world sizes that overlap the first copy of the map, so
// that a rectangle reaching past an edge also covers the opposite side
export function wrapRect([x, y, width, height]) {
    const [mapWidth, mapHeight] = PROG.map.size,
        out = [];
    for (let copyY = -1; copyY <= 1; copyY++)
        for (let copyX = -1; copyX <= 1; copyX++) {
            const left = x + copyX * mapWidth,
                top = y + copyY * mapHeight;
            if (left < mapWidth && left + width > 0 && top < mapHeight && top + height > 0)
                out.push([left, top, width, height]);
        }
    return out;
}
// the use elements that repeat one group of the map (id-group) around the first copy, hidden until the view reaches
// them
export function wrapCopies(id, group, mapWidth, mapHeight) {
    let html = '';
    for (let copyY = -WRAP_REACH; copyY <= WRAP_REACH; copyY++)
        for (let copyX = -WRAP_REACH; copyX <= WRAP_REACH; copyX++)
            if (copyX || copyY)
                html += `<use href="#${id}-${group}" data-kx="${copyX}" data-ky="${copyY}" x="${copyX * mapWidth}" y="${copyY * mapHeight}" style="display:none"/>`;
    return html;
}
// map position of a world square (not wrapped: rectangles may reach past the edge)
export function rawXY(x, y) {
    const [cornerX, cornerY] = PROG.map.corner,
        mapHeight = PROG.map.size[1];
    return [x - cornerX + 0.5, mapHeight - (y - cornerY) - 0.5];
}
// map position of a world square, inside the first copy of the map
export function mapXY(x, y) {
    const [mapWidth, mapHeight] = PROG.map.size,
        [mapX, mapY] = rawXY(x, y);
    return [mod(mapX, mapWidth), mod(mapY, mapHeight)];
}
// the shortest span on a circle of length circumference that holds the intervals [start, end]: [start in
// [0, circumference), length]
function arc(intervals, circumference) {
    const spans = intervals
        .map(([start, end]) => [mod(start, circumference), Math.min(end - start, circumference)])
        .toSorted((a, b) => a[0] - b[0]);
    const [first] = spans;
    let reach = first[0] + first[1],
        gap = 0,
        from = 0;
    for (const [start, length] of spans.slice(1)) {
        if (start - reach > gap) {
            gap = start - reach;
            from = start;
        }
        reach = Math.max(reach, start + length);
    }
    if (first[0] + circumference - reach > gap) {
        gap = first[0] + circumference - reach;
        from = first[0];
    }
    if (gap > 0) return [from, circumference - gap];
    return [0, circumference];
}
// the smallest box [x, y, w, h] on the torus map holding the rectangles (map coordinates), positioned in the first copy
export function torusBox(rects) {
    const [mapWidth, mapHeight] = PROG.map.size,
        [x, w] = arc(
            rects.map((rect) => [rect[0], rect[0] + rect[2]]),
            mapWidth,
        ),
        [y, h] = arc(
            rects.map((rect) => [rect[1], rect[1] + rect[3]]),
            mapHeight,
        );
    return { x, y, w, h };
}
