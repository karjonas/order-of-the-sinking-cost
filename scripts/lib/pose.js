// Poses the queen model's arms down from the bind pose (a T), for the hero icon. The skeleton's hierarchy comes from the
// character's animation file; the arms are found from where the bones' vertices lie, and each vertex follows them in
// proportion to its skin weights. No animation data is decoded.
import { Archive } from './archive.js';
import * as paths from './paths.js';

const BONE_COUNT_OFFSET = 10;
const PARENTS_OFFSET = 74;
const NO_PARENT = -1;
const SKIN_WEIGHTS_AT = 12;
const SKIN_BONES_AT = 16;
const SKIN_STRIDE = 20;
// A bone is part of an arm when its vertices lie at least this far out, as a fraction of the model's half-width
const ARM_REACH = 0.28;
const MIN_BONE_VERTICES = 8;
// and within this many metres of the height of the bone that reaches furthest (the hand), which leaves out the cape
const ARM_HEIGHT_BAND = 0.1;
const ARM_DROP_DEGREES = 75;
const SHOULDER_BAND = 0.03;

// The parent bone of each bone: a u16 bone count at byte 10 of the file, the parent indices (u16, 0xffff for none) at 74
export function readParents(animationName) {
    const archive = new Archive(paths.game('data', 'animation.package'));
    const file = archive.read(animationName);
    archive.close();
    const count = file.readUInt16LE(BONE_COUNT_OFFSET);
    const parents = [];
    for (let bone = 0; bone < count; bone++) {
        const stored = file.readUInt16LE(PARENTS_OFFSET + bone * 2);
        if (stored === 0xffff) {
            parents.push(NO_PARENT);
        } else {
            parents.push(stored);
        }
    }
    if (parents[0] !== NO_PARENT) throw new Error(`${animationName}: bone 0 has a parent`);
    return parents;
}

// The bones of the arm on each side (+1: y > 0, -1: y < 0), as sets of bone indices
function armBones(mesh, vertices, parents) {
    const sums = new Map();
    let reach = 0;
    for (const vertex of vertices) {
        const bone = mesh.skin[vertex * SKIN_STRIDE + SKIN_BONES_AT];
        const y = mesh.positions[vertex * 3 + 1];
        reach = Math.max(reach, Math.abs(y));
        const entry = sums.get(bone) ?? { totalY: 0, totalZ: 0, count: 0 };
        entry.totalY += y;
        entry.totalZ += mesh.positions[vertex * 3 + 2];
        entry.count++;
        sums.set(bone, entry);
    }
    let handHeight = 0;
    let handReach = 0;
    for (const entry of sums.values()) {
        const meanY = Math.abs(entry.totalY / entry.count);
        if (meanY <= handReach) continue;
        handReach = meanY;
        handHeight = entry.totalZ / entry.count;
    }
    const sides = new Map([
        [1, new Set()],
        [-1, new Set()],
    ]);
    for (const [bone, entry] of sums) {
        const meanY = entry.totalY / entry.count;
        const meanZ = entry.totalZ / entry.count;
        if (entry.count < MIN_BONE_VERTICES) continue;
        if (Math.abs(meanY) < ARM_REACH * reach) continue;
        if (Math.abs(meanZ - handHeight) > ARM_HEIGHT_BAND) continue;
        sides.get(Math.sign(meanY)).add(bone);
    }
    for (const bones of sides.values()) {
        for (let bone = 0; bone < parents.length; bone++) {
            if (bones.has(parents[bone])) bones.add(bone);
        }
    }
    return sides;
}

// The point the arm swings about: the inner end of the arm's vertices
function shoulderOf(mesh, vertices, bones, side) {
    let innermost = Infinity;
    const armVertices = [];
    for (const vertex of vertices) {
        if (!bones.has(mesh.skin[vertex * SKIN_STRIDE + SKIN_BONES_AT])) continue;
        armVertices.push(vertex);
        innermost = Math.min(innermost, Math.abs(mesh.positions[vertex * 3 + 1]));
    }
    const sum = [0, 0, 0];
    let count = 0;
    for (const vertex of armVertices) {
        if (Math.abs(mesh.positions[vertex * 3 + 1]) > innermost + SHOULDER_BAND) continue;
        sum[0] += mesh.positions[vertex * 3];
        sum[2] += mesh.positions[vertex * 3 + 2];
        count++;
    }
    return [sum[0] / count, side * innermost, sum[2] / count];
}

// Rotates (y, z) of a vector about the x axis by `radians`
function swing(y, z, radians) {
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return [y * cosine - z * sine, y * sine + z * cosine];
}

// Positions and normals with both arms swung down; `vertices` are the model's vertices that are drawn
export function lowerArms(mesh, vertices, parents) {
    const positions = Float32Array.from(mesh.positions);
    const normals = Float32Array.from(mesh.normals);
    const sides = armBones(mesh, vertices, parents);
    for (const [side, bones] of sides) {
        const shoulder = shoulderOf(mesh, vertices, bones, side);
        const radians = (-side * ARM_DROP_DEGREES * Math.PI) / 180;
        for (const vertex of vertices) {
            let armWeight = 0;
            for (let slot = 0; slot < 4; slot++) {
                const bone = mesh.skin[vertex * SKIN_STRIDE + SKIN_BONES_AT + slot];
                const weight = mesh.skin[vertex * SKIN_STRIDE + SKIN_WEIGHTS_AT + slot] / 255;
                if (bones.has(bone)) armWeight += weight;
            }
            if (armWeight === 0) continue;
            const y = mesh.positions[vertex * 3 + 1] - shoulder[1];
            const z = mesh.positions[vertex * 3 + 2] - shoulder[2];
            const [swungY, swungZ] = swing(y, z, radians);
            positions[vertex * 3 + 1] += armWeight * (swungY - y);
            positions[vertex * 3 + 2] += armWeight * (swungZ - z);
            const [normalY, normalZ] = swing(mesh.normals[vertex * 3 + 1], mesh.normals[vertex * 3 + 2], radians);
            normals[vertex * 3 + 1] += armWeight * (normalY - mesh.normals[vertex * 3 + 1]);
            normals[vertex * 3 + 2] += armWeight * (normalZ - mesh.normals[vertex * 3 + 2]);
        }
    }
    return { positions, normals };
}
