// Reader for the game's render assets (data-pc/*.compressed_mesh, *.texture; format in docs/GAMEDATA.md, Render assets)
import { readFileSync } from 'node:fs';
import * as paths from './paths.js';

const UTF8 = new TextDecoder();

// Decompresses an LZ4 block into a buffer of known size
function lz4Block(input, outputSize) {
    const output = new Uint8Array(outputSize);
    let inPos = 0;
    let outPos = 0;
    while (inPos < input.length) {
        const token = input[inPos++];
        let literalLength = token >> 4;
        if (literalLength === 15) {
            let extra = 255;
            while (extra === 255) {
                extra = input[inPos++];
                literalLength += extra;
            }
        }
        output.set(input.subarray(inPos, inPos + literalLength), outPos);
        inPos += literalLength;
        outPos += literalLength;
        if (inPos >= input.length) break;
        const offset = input[inPos] | (input[inPos + 1] << 8);
        inPos += 2;
        let matchLength = (token & 15) + 4;
        if ((token & 15) === 15) {
            let extra = 255;
            while (extra === 255) {
                extra = input[inPos++];
                matchLength += extra;
            }
        }
        for (let copied = 0; copied < matchLength; copied++) {
            output[outPos] = output[outPos - offset];
            outPos++;
        }
    }
    if (outPos !== outputSize) throw new Error(`lz4: got ${outPos} of ${outputSize} bytes`);
    return output;
}

// The header and the decompressed body of a data-pc asset
export function readAsset(path) {
    const file = new Uint8Array(readFileSync(path));
    const view = new DataView(file.buffer);
    const headerLength = view.getUint16(6, true);
    const total = view.getUint32(8, true);
    const header = file.subarray(0, headerLength);
    if (file.length === total) return { header, body: file.subarray(headerLength) };
    return { header, body: lz4Block(file.subarray(headerLength), total - headerLength) };
}

export function dataPcPath(name, extension) {
    return paths.game('data-pc', `${name}.${extension}`);
}

// A mesh: positions, uvs, vertex colours (default paint), the first LOD's triangle lists and the material names
export function readMesh(name) {
    const { body } = readAsset(dataPcPath(name, 'compressed_mesh'));
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    let pos = 0;
    const readU32 = () => {
        const value = view.getUint32(pos, true);
        pos += 4;
        return value;
    };
    const lodCount = readU32();
    const vertexCount = readU32();
    const checksum = readU32();
    const skinned = body[pos + 2] !== 0;
    pos += 4;
    pos += 6 * 4 + 2 * 4 + 4;
    const listCount = readU32();

    const positionStride = skinned ? 20 : 12;
    const positions = new Float32Array(vertexCount * 3);
    for (let vertex = 0; vertex < vertexCount; vertex++) {
        const at = pos + vertex * positionStride;
        positions[vertex * 3] = view.getFloat32(at, true);
        positions[vertex * 3 + 1] = view.getFloat32(at + 4, true);
        positions[vertex * 3 + 2] = view.getFloat32(at + 8, true);
    }
    const skin = skinned ? body.slice(pos, pos + vertexCount * positionStride) : null;
    pos += vertexCount * positionStride;

    const uvs = new Float32Array(vertexCount * 2);
    const attributes = body.subarray(pos, pos + vertexCount * 20);
    for (let vertex = 0; vertex < vertexCount; vertex++) {
        uvs[vertex * 2] = view.getFloat32(pos + vertex * 20, true);
        uvs[vertex * 2 + 1] = view.getFloat32(pos + vertex * 20 + 4, true);
    }
    pos += vertexCount * 20;
    const colors = body.slice(pos, pos + vertexCount * 4);
    pos += vertexCount * 4;

    const lods = [];
    for (let lod = 0; lod < lodCount; lod++) {
        const lists = [];
        for (let list = 0; list < listCount; list++) {
            lists.push({ material: readU32(), count: readU32(), first: readU32() });
        }
        const indexCount = readU32();
        const byteSize = readU32();
        const format = view.getUint16(pos, true);
        pos += 2;
        let indices;
        if (format === 0) {
            indices = new Uint16Array(indexCount);
            for (let k = 0; k < indexCount; k++) indices[k] = view.getUint16(pos + k * 2, true);
        } else {
            indices = new Uint32Array(indexCount);
            for (let k = 0; k < indexCount; k++) indices[k] = view.getUint32(pos + k * 4, true);
        }
        pos += byteSize;
        lods.push({ lists, indices });
    }
    const materials = [];
    for (let list = 0; list < listCount; list++) {
        const length = view.getUint16(pos, true);
        pos += 2;
        materials.push(UTF8.decode(body.subarray(pos, pos + length)));
        pos += length;
    }
    const normals = decodeNormals(attributes, vertexCount);
    return { name, checksum, vertexCount, skinned, skin, positions, uvs, attributes, normals, colors, lods, materials };
}

// The vertex normals: 10-10-10-2 unsigned normalised in the 4 bytes after each vertex's two texture coordinates
function decodeNormals(attributes, vertexCount) {
    const view = new DataView(attributes.buffer, attributes.byteOffset, attributes.byteLength);
    const normals = new Float32Array(vertexCount * 3);
    for (let vertex = 0; vertex < vertexCount; vertex++) {
        const packed = view.getUint32(vertex * 20 + 12, true);
        const x = (packed & 1023) / 511.5 - 1;
        const y = ((packed >>> 10) & 1023) / 511.5 - 1;
        const z = ((packed >>> 20) & 1023) / 511.5 - 1;
        const length = Math.hypot(x, y, z) || 1;
        normals[vertex * 3] = x / length;
        normals[vertex * 3 + 1] = y / length;
        normals[vertex * 3 + 2] = z / length;
    }
    return normals;
}
