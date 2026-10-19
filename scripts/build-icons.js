// Builds the marker icons of the page from the game's own 3D models: public/assets/icons/<name>.avif (128 px) and the
// favicon public/assets/icons/favicon-<size>.png.
//
// Reads the overworld entities in <game>/data/levels.package (tints and glow colours), data/schema.json, and the render
// assets of the game folder: data-pc/*.compressed_mesh and *.texture, data/materials.package and
// data-common/overworld.all_paint_data (format in docs/GAMEDATA.md, Render assets).
// Writes public/assets/icons/.
//
// Usage: node scripts/build-icons.js [--game DIR] [--only NAME[,NAME...]] [--png DIR]
//   --only   renders just those icons (names as in ICONS below)
//   --png    also writes each icon as a PNG into DIR, without encoding AVIF; nothing goes to public/assets/icons/
//
// Encoding to AVIF needs ImageMagick (`magick`) with AVIF support, on the PATH or inside WSL.
//
// - Each icon is one mesh (or a few) of the entity type it marks, drawn with the tints of one placed entity of that
//   type, in an orthographic three-quarter view (camera south of the object, turned 25 degrees east, 42 degrees up; the
//   Level_Entry and Teleporter pads straight from above, the sign and the ice gate face-on) with smooth shading from
//   the vertex normals, a key light from the top left, a fill light and a rim light, a dark outline and a drop shadow.
// - The Teleporters' glowing parts take the entity's color_discovered. The level pads use the viewer's own stone and
//   glow colours (STONE_COLORS, GLOW_GROUPS), stronger than the game's, so the states tell apart at a glance.
// - The hero is the queen model without her props, her arms swung down from the bind pose's T, framed as a bust.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from './lib/fields.js';
import { Materials, normalized } from './lib/materials.js';
import { readMesh } from './lib/mesh.js';
import { PaintData } from './lib/paint.js';
import { lowerArms, readParents } from './lib/pose.js';
import { Package } from './lib/package.js';
import * as paths from './lib/paths.js';
import { encodePng } from './lib/png.js';
import { renderMesh } from './lib/rasterizer.js';
import { Textures, srgbToLinear } from './lib/textures.js';

const ICON_SIZE = 128;
const ICON_MARGIN = 5;
const OUTLINE_PIXELS = 1.4;
const AVIF_QUALITY = 82;
const FAVICON_SIZES = [32, 64];
const OVERWORLD = 'overworld';
const DEFAULT_VIEW = { azimuth: 25, elevation: 42 };
const BUST_BOTTOM = 1.2;
const FACE_VIEW = { azimuth: 90, elevation: 24 };
const TOP_VIEW = { azimuth: 0, elevation: 90 };
const WHITE = [1, 1, 1];

const ENTITY_TYPES = new Set([
    'Freezer',
    'Sign',
    'Teleporter',
    'Level_Entry',
    'Voice_Log',
    'View_Giver',
    'Tower',
    'Treasure_Display',
    'Guy',
]);

// The glow colours of the Level_Entry groups (`glow` in data/progress.json), each near the median of its group's
// `color_active`, tuned so the five tell apart at icon size
const GLOW_GROUPS = {
    green: '#4fe06c',
    orange: '#ff8a1e',
    yellow: '#ffd21a',
    blue: '#2ab4ff',
    purple: '#b048ff',
};

// The level pads in the viewer's own colours, stronger than the game's so the states tell apart at a glance: the
// stone's tint and the glow (null: no glowing parts; absent: the group's glow is added). A solved pad has a dim gold
// stone and no glow.
const STONE_COLORS = {
    locked: { stone: '#4a5058', glow: null },
    open: { stone: '#8c8a80' },
    solved: { stone: '#8a7440', glow: null },
};

// The Level_Entry models of each pad shape: the plain 8-point pads and the tower levels' 16-point ones
const PAD_SHAPES = [
    { prefix: 'level-', mesh: 'GAME_OVER_Entry_' },
    { prefix: 'level-tower-', mesh: 'GAME_OVER_Entry_Hero_' },
];

function levelPadSpecs() {
    const specs = [];
    for (const shape of PAD_SHAPES) {
        const locked = `${shape.mesh}Locked_A`;
        const available = `${shape.mesh}Available_A`;
        const pad = { type: 'Level_Entry', view: TOP_VIEW };
        specs.push({ ...pad, name: `${shape.prefix}locked`, mesh: locked, viewerColors: STONE_COLORS.locked });
        specs.push({
            ...pad,
            name: `${shape.prefix}solved`,
            mesh: available,
            viewerColors: STONE_COLORS.solved,
        });
        for (const [group, glow] of Object.entries(GLOW_GROUPS)) {
            specs.push({
                ...pad,
                name: `${shape.prefix}available-${group}`,
                mesh: available,
                viewerColors: { ...STONE_COLORS.open, glow },
            });
        }
    }
    return specs;
}

const FAVICON = {
    name: 'favicon',
    type: 'Level_Entry',
    mesh: 'GAME_OVER_Entry_Available_A',
    parts: ['GAME_OVER_Entry_Solved_A'],
    viewerColors: { stone: '#b8902c', glow: '#e6b83a' },
    view: TOP_VIEW,
    outline: 0.5,
    shadow: false,
};

// The Teleporter pad that marks a tower's pad and, with a gold room endpoint, the gold room
const TELEPORTER_PAD = {
    type: 'Teleporter',
    mesh: 'GAME_OVER_Reset_C',
    effect: 'color_discovered',
    view: TOP_VIEW,
};

// type, mesh: the placed entity whose tints are used (the first with that mesh, and `where` true when given);
// parts: the meshes drawn, default the entity's own; effect: the entity colour field that colours the glowing parts;
// viewerColors: stone and glow colours that replace the entity's; outline: the outline width in output pixels and
// shadow: whether to draw the drop shadow, default OUTLINE_PIXELS and true
const ICONS = [
    { name: 'ice-cage', type: 'Freezer', mesh: 'GAME_OVER_Freezer_A' },
    { name: 'ice-gate', type: 'Freezer', mesh: 'GAME_OVER_Freezer_B', view: FACE_VIEW },
    { name: 'sign', type: 'Sign', mesh: 'overworld_plaque', view: FACE_VIEW },
    { name: 'teleporter', type: 'Teleporter', mesh: 'GAME_OVER_Reset_B', effect: 'color_discovered', view: TOP_VIEW },
    { ...TELEPORTER_PAD, name: 'tower-pad', where: notGold },
    { ...TELEPORTER_PAD, name: 'gold-room', where: isGold },
    { name: 'voice-log', type: 'Voice_Log', mesh: 'GAME_OVER_Story_A' },
    { name: 'map-scroll', type: 'View_Giver', mesh: 'GAME_EX_CamControl_Scroll' },
    { name: 'treasure', type: 'Treasure_Display', mesh: 'GAME_SKIP_Treasure_Plinth_A', withTreasure: true },
    {
        name: 'treasure-taken',
        type: 'Treasure_Display',
        mesh: 'GAME_SKIP_Treasure_Plinth_A',
        parts: ['GAME_SKIP_Treasure_Chest_Open_A'],
    },
    ...levelPadSpecs(),
    {
        name: 'hero',
        type: 'Guy',
        mesh: 'queen',
        view: { azimuth: 90, elevation: 12 },
        onlyMaterials: /^queen_/,
        pose: true,
        fitAbove: BUST_BOTTOM,
    },
];

function isGold(fields) {
    return fields.gold_room_endpoint === true;
}

function notGold(fields) {
    return fields.gold_room_endpoint !== true;
}

function vectorField(fields, prefix) {
    const x = fields[`${prefix}.x`];
    if (x === undefined) return null;
    return [x, get(fields, `${prefix}.y`, 0), get(fields, `${prefix}.z`, 0), get(fields, `${prefix}.w`, 0)];
}

// The colour a glowing part emits for a state colour [r, g, b, intensity]: its hue, dimmer for a dim or weak colour
function glowColor(state) {
    const hue = normalized(state);
    const largest = Math.max(state[0], state[1], state[2], 1e-6);
    const brightness = 0.5 + (0.5 * Math.min(state[3], 30)) / 30;
    const strength = brightness * Math.sqrt(Math.min(1, largest));
    return [hue[0] * strength, hue[1] * strength, hue[2] * strength];
}

function hexToLinear(hex) {
    const bytes = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
    return bytes.map((byte) => srgbToLinear(byte));
}

function pickEntity(entities, spec) {
    for (const entity of entities) {
        if (entity.type !== spec.type) continue;
        if (entity.fields['base.mesh'] !== spec.mesh) continue;
        if (spec.where && !spec.where(entity.fields)) continue;
        return entity;
    }
    throw new Error(`${spec.name}: no ${spec.type} with mesh ${spec.mesh}`);
}

// A mesh placed at `offset`, its triangles' materials shaded for `entity`
function loadPart(meshName, entity, context, spec) {
    const mesh = readMesh(meshName);
    const lod = mesh.lods[0];
    const overrides = entity.fields['base.materials'] ?? [];
    const shadingEntity = {
        tintA: vectorField(entity.fields, 'base.tint_color_a')?.slice(0, 3) ?? WHITE,
        tintB: vectorField(entity.fields, 'base.tint_color_b')?.slice(0, 3) ?? WHITE,
        effectColor: null,
        noGlow: false,
    };
    if (spec.effect) shadingEntity.effectColor = glowColor(vectorField(entity.fields, spec.effect));
    if (spec.viewerColors) {
        const stone = hexToLinear(spec.viewerColors.stone);
        shadingEntity.tintA = stone;
        shadingEntity.tintB = stone;
        if (spec.viewerColors.glow) {
            shadingEntity.effectColor = hexToLinear(spec.viewerColors.glow);
        } else {
            shadingEntity.noGlow = true;
        }
    }
    const shadings = lod.lists.map((list) => {
        let materialName = mesh.materials[list.material];
        if (overrides[list.material]) materialName = overrides[list.material];
        if (spec.onlyMaterials && !spec.onlyMaterials.test(materialName)) return null;
        return context.materials.shading(materialName, shadingEntity);
    });
    const paint = context.paint.forMesh(entity.pid, mesh);
    if (spec.pose) {
        const vertices = new Set();
        lod.lists.forEach((list, index) => {
            if (!shadings[index]) return;
            for (let k = list.first; k < list.first + list.count; k++) vertices.add(lod.indices[k]);
        });
        const parents = readParents(`data-common/${meshName}.anim`);
        const { positions, normals } = lowerArms(mesh, vertices, parents);
        return { mesh, positions, normals, paint, shadings };
    }
    return { mesh, positions: mesh.positions, normals: mesh.normals, paint, shadings };
}

function boundsOf(part) {
    const lod = part.mesh.lods[0];
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    lod.lists.forEach((list, index) => {
        if (!part.shadings[index]) return;
        for (let k = list.first; k < list.first + list.count; k++) {
            const vertex = lod.indices[k];
            for (let axis = 0; axis < 3; axis++) {
                const value = part.positions[vertex * 3 + axis];
                low[axis] = Math.min(low[axis], value);
                high[axis] = Math.max(high[axis], value);
            }
        }
    });
    return { low, high };
}

// One part moved by `offset` and scaled by `scale`, as a copy
function placed(part, offset, scale) {
    const positions = new Float32Array(part.positions.length);
    for (let k = 0; k < positions.length; k++) positions[k] = part.positions[k] * scale + offset[k % 3];
    return { ...part, positions };
}

// Several parts as one mesh: vertices, paint and triangle lists appended, the material indices made unique
function merge(parts) {
    if (parts.length === 1) return parts[0];
    let vertexCount = 0;
    for (const part of parts) vertexCount += part.mesh.vertexCount;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const normals = new Float32Array(vertexCount * 3);
    const paint = new Uint8Array(vertexCount * 4);
    const lists = [];
    const indices = [];
    const shadings = [];
    let vertexOffset = 0;
    for (const part of parts) {
        positions.set(part.positions, vertexOffset * 3);
        uvs.set(part.mesh.uvs, vertexOffset * 2);
        normals.set(part.normals, vertexOffset * 3);
        paint.set(part.paint, vertexOffset * 4);
        const lod = part.mesh.lods[0];
        lod.lists.forEach((list, index) => {
            lists.push({ material: 0, count: list.count, first: indices.length });
            shadings.push(part.shadings[index]);
            for (let k = list.first; k < list.first + list.count; k++) indices.push(lod.indices[k] + vertexOffset);
        });
        vertexOffset += part.mesh.vertexCount;
    }
    const mesh = { vertexCount, uvs, lods: [{ lists, indices: Uint32Array.from(indices) }] };
    return { mesh, positions, normals, paint, shadings };
}

// The treasure item stands on top of the plinth, at most half the plinth's width across
function plinthWithTreasure(plinth, item) {
    const plinthBounds = boundsOf(plinth);
    const itemBounds = boundsOf(item);
    const plinthWidth = Math.max(
        plinthBounds.high[0] - plinthBounds.low[0],
        plinthBounds.high[1] - plinthBounds.low[1],
    );
    const itemWidth = Math.max(itemBounds.high[0] - itemBounds.low[0], itemBounds.high[1] - itemBounds.low[1]);
    const scale = Math.min(1, (plinthWidth * 0.5) / itemWidth);
    const offset = [
        -((itemBounds.low[0] + itemBounds.high[0]) / 2) * scale,
        -((itemBounds.low[1] + itemBounds.high[1]) / 2) * scale,
        plinthBounds.high[2] - itemBounds.low[2] * scale,
    ];
    return merge([plinth, placed(item, offset, scale)]);
}

function buildScene(spec, context) {
    const entity = pickEntity(context.entities, spec);
    const meshNames = spec.parts ?? [spec.mesh];
    const parts = meshNames.map((name) => loadPart(name, entity, context, spec));
    if (spec.withTreasure) {
        const treasurePid = entity.fields.treasure_mesh_id[1];
        const treasure = context.positions.entities.find((candidate) => candidate[0] === treasurePid);
        const treasureMesh = context.positions.meshes[treasure[5]];
        const item = loadPart(treasureMesh, { fields: { 'base.materials': [] }, pid: treasurePid }, context, {});
        return plinthWithTreasure(parts[0], item);
    }
    return merge(parts);
}

function renderIcon(spec, context, size, margin) {
    const scene = buildScene(spec, context);
    return renderMesh({
        ...scene,
        view: spec.view ?? DEFAULT_VIEW,
        size,
        margin,
        outline: spec.outline ?? OUTLINE_PIXELS,
        shadow: spec.shadow ?? true,
        fitAbove: spec.fitAbove,
    });
}

function findMagick() {
    try {
        execFileSync('magick', ['-version'], { stdio: 'ignore' });
        return { command: 'magick', prefix: [], toPath: (path) => path };
    } catch {
        // not on the Windows PATH; try WSL
    }
    const toWslPath = (path) => '/mnt/' + path[0].toLowerCase() + path.slice(2).replaceAll('\\', '/');
    execFileSync('wsl.exe', ['-e', 'magick', '-version'], { stdio: 'ignore' });
    return { command: 'wsl.exe', prefix: ['-e', 'magick'], toPath: toWslPath };
}

function encodeAvif(magick, pngPath, avifPath) {
    const args = [...magick.prefix, magick.toPath(pngPath), '-quality', String(AVIF_QUALITY), magick.toPath(avifPath)];
    execFileSync(magick.command, args, { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
}

function main() {
    const { values } = paths.parseCommandLine({
        only: { type: 'string' },
        png: { type: 'string' },
        size: { type: 'string' },
    });
    let iconSize = ICON_SIZE;
    if (values.size) iconSize = Number(values.size);
    const wanted = values.only ? new Set(values.only.split(',')) : null;
    const textures = new Textures();
    const materials = new Materials(textures);
    const pkg = new Package();
    const context = {
        materials,
        entities: pkg.levelWithDefaults(OVERWORLD, ENTITY_TYPES),
        positions: pkg.positions(OVERWORLD),
        paint: new PaintData(OVERWORLD),
    };
    pkg.close();

    const outputDirectory = join(paths.ROOT, 'public', 'assets', 'icons');
    const pngDirectory = values.png ?? null;
    if (pngDirectory) {
        mkdirSync(pngDirectory, { recursive: true });
    } else {
        mkdirSync(outputDirectory, { recursive: true });
    }
    let magick = null;
    let workDirectory = null;
    if (!pngDirectory) {
        magick = findMagick();
        workDirectory = mkdtempSync(join(tmpdir(), 'soko-icons-'));
    }

    let totalBytes = 0;
    for (const spec of ICONS) {
        if (wanted && !wanted.has(spec.name)) continue;
        const rgba = renderIcon(spec, context, iconSize, ICON_MARGIN);
        const png = encodePng(rgba, iconSize, iconSize);
        if (pngDirectory) {
            writeFileSync(join(pngDirectory, `${spec.name}.png`), png);
            console.log(`${spec.name}.png`);
            continue;
        }
        const pngPath = join(workDirectory, `${spec.name}.png`);
        const avifPath = join(outputDirectory, `${spec.name}.avif`);
        writeFileSync(pngPath, png);
        encodeAvif(magick, pngPath, avifPath);
        const bytes = statSync(avifPath).size;
        totalBytes += bytes;
        console.log(`${spec.name}.avif ${bytes} bytes`);
    }

    if (!wanted || wanted.has('favicon')) {
        const directory = pngDirectory ?? outputDirectory;
        for (const size of FAVICON_SIZES) {
            const rgba = renderIcon(FAVICON, context, size, 1);
            const path = join(directory, `favicon-${size}.png`);
            writeFileSync(path, encodePng(rgba, size, size));
            console.log(`favicon-${size}.png`);
        }
    }
    if (workDirectory) rmSync(workDirectory, { recursive: true });
    materials.close();
    if (totalBytes) console.log(`total ${totalBytes} bytes`);
}

main();
