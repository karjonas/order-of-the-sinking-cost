// The map markers and the icons drawn in their shapes: level states, roles, achievements and the overlays
// (VIEWER.md "Level states (viewer)", "Level roles (viewer)" and "The page (viewer)")
export const STATE_COLORS = {
    solved: 'var(--gold)',
    partial: 'var(--warn)',
    visited: 'var(--entered)',
    unlocked: 'var(--open)',
    blocked: '#a3846a',
    locked: 'var(--locked)',
};
// marker shapes: SVG paths around (0, 0) at a radius
export const SHAPES = {
    tri: {
        path: (radius) => `M0 ${-radius * 1.2}L${radius * 1.1} ${radius * 0.8}L${-radius * 1.1} ${radius * 0.8}Z`,
    },
    square: {
        path: (radius) => `M${-radius * 0.9} ${-radius * 0.9}h${radius * 1.8}v${radius * 1.8}h${-radius * 1.8}Z`,
    },
    hex: {
        path: (radius) => {
            const corner = radius * 1.1;
            const corners = [0, 1, 2, 3, 4, 5].map((index) => {
                const angle = (Math.PI / 3) * index - Math.PI / 2;
                return `${(corner * Math.cos(angle)).toFixed(2)} ${(corner * Math.sin(angle)).toFixed(2)}`;
            });
            return 'M' + corners.join('L') + 'Z';
        },
    },
    circle: {
        path: (radius) =>
            `M${-radius} 0a${radius} ${radius} 0 1 0 ${2 * radius} 0a${radius} ${radius} 0 1 0 ${-2 * radius} 0Z`,
    },
};
export const ROLE_SHAPES = { req: 'tri', one: 'square', optional: 'circle' };
// achievement levels carry a small hex at the upper right of a marker of a radius
const ACH_COLOR = 'var(--ach)';
export const ACH_BADGE = (radius) =>
    SHAPES.hex
        .path(2.6)
        .replace(
            /(-?[\d.]+) (-?[\d.]+)/g,
            (_, x, y) => `${(+x + radius * 0.9).toFixed(2)} ${(+y - radius * 0.9).toFixed(2)}`,
        );
// every marker icon is drawn in the same 16 px box with the map marker's shape
export const svgIcon = (path, fill, stroke, strokeWidth = 1) =>
    `<svg class="ic" viewBox="-8 -8 16 16" aria-hidden="true"><path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
const ICON_R = 5.5;
export const ICON_STROKE = 'rgba(5, 10, 14, .75)';
export const shapeIcon = (shape, color) => svgIcon(SHAPES[shape].path(ICON_R), color, ICON_STROKE);
export const starIcon = (color) => svgIcon(STAR, color, '#4a3505');
export const ringIcon = svgIcon(SHAPES.circle.path(ICON_R - 1), 'none', '#fff', 2);
export const towerIcon = svgIcon(SHAPES.circle.path(ICON_R), 'none', 'var(--text)', 1.5);
export const checkIcon = svgIcon('M-4.5 0.5L-1.5 3.5L4.5 -3.5', 'none', 'var(--gold)', 2);
export const eyeIcon = svgIcon(
    'M-6.5 0Q0 -6.5 6.5 0Q0 6.5 -6.5 0ZM-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z',
    'none',
    'currentColor',
    1.5,
);
export const roleDot = (role) => (role ? shapeIcon(ROLE_SHAPES[role], ROLES[role][1]) : '');
// A level's role for a goal (roleFor): on every route to the goal, on some of its routes, or not needed for it
export const ROLES = {
    req: ['Required', '#f08a5d'],
    one: ['One of several', '#c6d86a'],
    optional: ['Optional', '#b39ddb'],
};
export const achIcon = svgIcon(SHAPES.hex.path(3.6), ACH_COLOR, ICON_STROKE);
// eight-pointed stars in screen pixels, about 13 and 18 px across
export const STAR =
    'M0 -6.5L1.14 -2.76L4.6 -4.6L2.76 -1.14L6.5 0L2.76 1.14L4.6 4.6L1.14 2.76L0 6.5L-1.14 2.76L-4.6 4.6L-2.76 1.14L-6.5 0L-2.76 -1.14L-4.6 -4.6L-1.14 -2.76Z';
export const STAR_BIG =
    'M0 -9L1.58 -3.82L6.36 -6.36L3.82 -1.58L9 0L3.82 1.58L6.36 6.36L1.58 3.82L0 9L-1.58 3.82L-6.36 6.36L-3.82 1.58L-9 0L-3.82 -1.58L-6.36 -6.36L-1.58 -3.82Z';
// the hero: a head over shoulders
export const HERO_PATH = 'M-2.2 -4.6a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0ZM-4.6 6Q-4.6 -0.8 0 -0.8Q4.6 -0.8 4.6 6Z';
// a plaque on a post
const SIGN_PATH = 'M-4.5 -5.5h9a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-9a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1ZM-1 0.5h2v5.5h-2Z';
// the invisible pad that makes a small overlay mark easier to click
export const OV_PAD = 'M-8 -8h16v16h-16Z';
export const OV_PATHS = {
    log: 'M-3 -4.5L4.5 0L-3 4.5Z',
    map: 'M-3.5 -5.5h7v11h-7Z',
    sign: SIGN_PATH,
    gate: 'M-3.5 -3.5h7v7h-7Z',
    tp: SHAPES.circle.path(4.5),
    gold: SHAPES.circle.path(6.5),
    treasure: 'M0 -6L4.5 0L0 6L-4.5 0Z',
};
export const OV_ICONS = {
    gates: svgIcon('M-4.5 -4.5h9v9h-9Z', 'var(--ov-gate)', ICON_STROKE),
    tps: svgIcon(OV_PATHS.tp, 'none', 'var(--ov-tp)', 2.5),
    treasures: svgIcon('M0 -7L5.5 0L0 7L-5.5 0Z', 'var(--ov-plinth)', ICON_STROKE),
    logs: svgIcon('M-3.5 -5L5 0L-3.5 5Z', 'var(--ov-log)', ICON_STROKE),
    reach: svgIcon('M-5.5 -3.5h11v7h-11Z', 'var(--reach)', ICON_STROKE),
};
// sidebar totals: the overlay icons where there is one
export const ST_ICONS = {
    ach: shapeIcon('hex', ACH_COLOR),
    treasures: OV_ICONS.treasures,
    gates: OV_ICONS.gates,
    tps: OV_ICONS.tps,
    gold: svgIcon(SHAPES.circle.path(5.5), 'none', 'var(--gold)', 2.5),
    logs: OV_ICONS.logs,
};
