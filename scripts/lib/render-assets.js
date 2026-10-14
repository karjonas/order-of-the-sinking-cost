// Readers for the game's render assets, used by build-map.js: .compressed_mesh, .texture, .material (from
// data/materials.package) and <level>.all_paint_data. Formats are described in docs/GAMEDATA.md, "Render assets".
//
// Reads from the game folder: data-pc/*.compressed_mesh, data-pc/*.texture, data-common/<level>.all_paint_data and
// data/materials.package.
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Archive } from './archive.js';
import * as paths from './paths.js';

// Decompresses one LZ4 block of `size` bytes starting at `start` in `source`
export function lz4Decompress(source, start, size) {
    const out = Buffer.alloc(size);
    let readAt = start;
    let writeAt = 0;
    while (readAt < source.length && writeAt < size) {
        const token = source[readAt++];
        let literalLength = token >> 4;
        if (literalLength === 15) {
            let extra;
            do {
                extra = source[readAt++];
                literalLength += extra;
            } while (extra === 255);
        }
        source.copy(out, writeAt, readAt, readAt + literalLength);
        readAt += literalLength;
        writeAt += literalLength;
        if (readAt >= source.length || writeAt >= size) break;
        const offset = source[readAt] | (source[readAt + 1] << 8);
        readAt += 2;
        let matchLength = token & 15;
        if (matchLength === 15) {
            let extra;
            do {
                extra = source[readAt++];
                matchLength += extra;
            } while (extra === 255);
        }
        matchLength += 4;
        let from = writeAt - offset;
        for (let i = 0; i < matchLength && writeAt < size; i++) out[writeAt++] = out[from++];
    }
    if (writeAt !== size) throw new Error(`LZ4 block ends after ${writeAt} of ${size} bytes`);
    return out;
}

// Common asset header: u16, u16, u16, u16 header length, u32 total size (header included), then an LZ4 block
export function unpackAsset(data) {
    const headerLength = data.readUInt16LE(6);
    const totalSize = data.readUInt32LE(8);
    if (totalSize === data.length) return data.subarray(headerLength);
    return lz4Decompress(data, headerLength, totalSize - headerLength);
}

class MeshFormatError extends Error {}

// A mesh: float32 vertex positions (x, y, z per vertex), texture coordinates (u, v per vertex), the default vertex
// paint, and per LOD a list of [material index, Int32Array of triangle vertex indexes]
export function readMesh(name) {
    const path = paths.game('data-pc', name + '.compressed_mesh');
    if (!existsSync(path)) return null;
    try {
        return parseMesh(name, unpackAsset(readFileSync(path)));
    } catch (error) {
        // skinned character meshes interleave other data and are not decoded
        if (error instanceof MeshFormatError || error instanceof RangeError) return null;
        throw error;
    }
}

function copyOf(buffer, offset, count, Type) {
    const bytes = count * Type.BYTES_PER_ELEMENT;
    if (offset + bytes > buffer.length) throw new MeshFormatError('mesh data ends early');
    const copy = new Uint8Array(bytes);
    copy.set(buffer.subarray(offset, offset + bytes));
    return new Type(copy.buffer);
}

function parseMesh(name, data) {
    const lodCount = data.readUInt32LE(0);
    const vertexCount = data.readUInt32LE(4);
    const checksum = data.readUInt32LE(8);
    const skinned = data[14];
    const bounds = [];
    for (let i = 0; i < 6; i++) bounds.push(data.readFloatLE(16 + 4 * i));
    const listCount = data.readUInt32LE(52);
    const positions = copyOf(data, 56, vertexCount * 3, Float32Array);
    const limit = Math.max(...bounds.map(Math.abs)) * 1.01 + 0.01;
    let largest = 0;
    for (const value of positions) largest = Math.max(largest, Math.abs(value));
    if (vertexCount && !(largest <= Math.fround(limit))) {
        throw new MeshFormatError(`${name}: vertex positions outside the bounding box`);
    }
    let at = 56 + vertexCount * (12 + (skinned !== 0 ? 8 : 0));
    const uvs = vertexUvs(data, at, vertexCount);
    at += vertexCount * VERTEX_EXTRA_BYTES;
    // default vertex paint, same layout as all_paint_data
    const colors = copyOf(data, at, vertexCount, Uint32Array);
    at += vertexCount * 4;
    const lods = [];
    for (let lod = 0; lod < lodCount; lod++) {
        const lists = [];
        for (let i = 0; i < listCount; i++) {
            lists.push({
                material: data.readUInt32LE(at + 12 * i),
                count: data.readUInt32LE(at + 12 * i + 4),
                first: data.readUInt32LE(at + 12 * i + 8),
            });
        }
        at += 12 * listCount;
        const indexCount = data.readUInt32LE(at);
        const byteCount = data.readUInt32LE(at + 4);
        const format = data.readUInt16LE(at + 8);
        at += 10;
        const raw = copyOf(data, at, indexCount, format === 0 ? Uint16Array : Uint32Array);
        const indexes = Int32Array.from(raw);
        at += byteCount;
        lods.push(
            lists.map(({ material, count, first }) => ({
                material,
                triangles: indexes.slice(first, first + count),
            })),
        );
    }
    const materials = [];
    for (let i = 0; i < listCount; i++) {
        const length = data.readUInt16LE(at);
        at += 2;
        materials.push(data.toString('utf8', at, at + length));
        at += length;
    }
    return { name, checksum, vertexCount, positions, uvs, colors, lods, materials };
}

// Each vertex's 20 bytes of shading data start with its texture coordinate, f32 u and f32 v
const VERTEX_EXTRA_BYTES = 20;

function vertexUvs(data, start, vertexCount) {
    if (start + vertexCount * VERTEX_EXTRA_BYTES > data.length) throw new MeshFormatError('mesh data ends early');
    const uvs = new Float32Array(vertexCount * 2);
    for (let vertex = 0; vertex < vertexCount; vertex++) {
        uvs[vertex * 2] = data.readFloatLE(start + vertex * VERTEX_EXTRA_BYTES);
        uvs[vertex * 2 + 1] = data.readFloatLE(start + vertex * VERTEX_EXTRA_BYTES + 4);
    }
    return uvs;
}

// .texture formats by header byte 20: block size in pixels, bytes per block, kind
const TEXTURE_FORMATS = {
    0: { blockSize: 4, blockBytes: 8, kind: 'bc1' },
    1: { blockSize: 4, blockBytes: 16, kind: 'bc3' },
    5: { blockSize: 1, blockBytes: 4, kind: 'raw' },
};

// R, G, B of a 16-bit 5:6:5 colour, each expanded to 8 bits
function colour565(value) {
    const red = ((value >> 8) & 0xf8) | (value >> 13);
    const green = ((value >> 3) & 0xfc) | ((value >> 9) & 3);
    const blue = ((value << 3) & 0xf8) | ((value >> 2) & 7);
    return [red, green, blue];
}

// The weighted average of two colours per channel (rounded down), fully opaque
function weightedMix(near, far, nearWeight, farWeight, divisor) {
    const mixed = near.map((value, channel) => Math.floor((nearWeight * value + farWeight * far[channel]) / divisor));
    return [...mixed, 255];
}

// The four colours of a BC1 colour block, as [r, g, b, a]
function bc1Palette(block, at) {
    const low = block[at] | (block[at + 1] << 8);
    const high = block[at + 2] | (block[at + 3] << 8);
    const first = colour565(low);
    const second = colour565(high);
    const palette = [
        [...first, 255],
        [...second, 255],
    ];
    if (low > high) {
        palette.push(weightedMix(first, second, 2, 1, 3));
        palette.push(weightedMix(first, second, 1, 2, 3));
    } else {
        palette.push(weightedMix(first, second, 1, 1, 2));
        palette.push([0, 0, 0, 255]);
    }
    return palette;
}

// The eight alpha values of a BC3 alpha block
function bc3Alphas(block, at) {
    const first = block[at];
    const second = block[at + 1];
    const alphas = [first, second];
    if (first > second) {
        for (let k = 1; k <= 6; k++) alphas.push(Math.floor(((7 - k) * first + k * second) / 7));
    } else {
        for (let k = 1; k <= 4; k++) alphas.push(Math.floor(((5 - k) * first + k * second) / 5));
        alphas.push(0, 255);
    }
    return alphas;
}

// Decodes block-compressed rows (blocksWide x blocksHigh blocks) to RGBA bytes, (blocksHigh * 4) rows of
// (blocksWide * 4) pixels
function decodeBlocks(rows, blocksWide, blocksHigh, kind) {
    const width = blocksWide * 4;
    const out = new Uint8Array(width * blocksHigh * 4 * 4);
    const blockBytes = kind === 'bc1' ? 8 : 16;
    for (let blockY = 0; blockY < blocksHigh; blockY++) {
        for (let blockX = 0; blockX < blocksWide; blockX++) {
            const at = (blockY * blocksWide + blockX) * blockBytes;
            const colourAt = kind === 'bc1' ? at : at + 8;
            const palette = bc1Palette(rows, colourAt);
            const indexes = rows.readUInt32LE(colourAt + 4);
            let alphas = null;
            let alphaBits = 0n;
            if (kind === 'bc3') {
                alphas = bc3Alphas(rows, at);
                alphaBits = rows.readBigUInt64LE(at) >> 16n;
            }
            for (let pixel = 0; pixel < 16; pixel++) {
                const colour = palette[(indexes >>> (2 * pixel)) & 3];
                const x = blockX * 4 + (pixel & 3);
                const y = blockY * 4 + (pixel >> 2);
                const offset = (y * width + x) * 4;
                out[offset] = colour[0];
                out[offset + 1] = colour[1];
                out[offset + 2] = colour[2];
                out[offset + 3] = alphas ? alphas[Number((alphaBits >> BigInt(3 * pixel)) & 7n)] : colour[3];
            }
        }
    }
    return out;
}

// RGBA image { width, height, data: Float32Array of 0..1 values as stored } of the first mip no larger than
// maxDimension, or null
export function textureImage(name, maxDimension = 64) {
    const path = paths.game('data-pc', name + '.texture');
    if (!existsSync(path)) return null;
    const file = readFileSync(path);
    let width = file.readUInt16LE(12);
    let height = file.readUInt16LE(14);
    const mips = file.readUInt16LE(18);
    const format = TEXTURE_FORMATS[file[20]];
    if (!format) return null;
    const data = unpackAsset(file);
    let offset = 0;
    for (let level = 0; level < mips; level++) {
        const blocksWide = Math.max(1, Math.floor((width + format.blockSize - 1) / format.blockSize));
        const blocksHigh = Math.max(1, Math.floor((height + format.blockSize - 1) / format.blockSize));
        const pitch = Math.floor((blocksWide * format.blockBytes + 255) / 256) * 256;
        if (Math.max(width, height) <= maxDimension || level === mips - 1) {
            return finishImage(data, offset, { width, height, blocksWide, blocksHigh, pitch }, format);
        }
        offset += Math.floor((blocksHigh * pitch + 511) / 512) * 512;
        width = Math.max(1, Math.floor(width / 2));
        height = Math.max(1, Math.floor(height / 2));
    }
    return null;
}

function finishImage(data, offset, size, format) {
    const { width, height, blocksWide, blocksHigh, pitch } = size;
    const rowBytes = blocksWide * format.blockBytes;
    const rows = Buffer.alloc(rowBytes * blocksHigh);
    for (let row = 0; row < blocksHigh; row++)
        data.copy(rows, row * rowBytes, offset + row * pitch, offset + row * pitch + rowBytes);
    let pixels;
    let stride;
    if (format.kind === 'raw') {
        pixels = rows;
        stride = blocksWide;
    } else {
        pixels = decodeBlocks(rows, blocksWide, blocksHigh, format.kind);
        stride = blocksWide * 4;
    }
    const out = new Float32Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            for (let channel = 0; channel < 4; channel++) {
                out[(y * width + x) * 4 + channel] = pixels[(y * stride + x) * 4 + channel] / 255;
            }
        }
    }
    return { width, height, data: out };
}

// A decimal number with an optional sign, fraction and exponent
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseNumber(text) {
    const trimmed = text.trim();
    if (DECIMAL.test(trimmed)) return Number(trimmed);
    return null;
}

function parseMaterialValue(rawValue) {
    let value = rawValue.trim();
    if (value.startsWith('"')) value = value.slice(1).split('"')[0];
    else value = value.split('#')[0].trim();
    if (value.startsWith('(')) {
        const inner = value.replace(/^[()]+|[()]+$/g, '');
        return inner.split(/\s+/).filter(Boolean).map(parseNumber);
    }
    if (value === 'true') return true;
    if (value === 'false') return false;
    const number = parseNumber(value);
    if (number !== null) return number;
    return value;
}

// Text materials from data/materials.package, keyed by file name without extension
export class Materials {
    constructor(path = paths.game('data', 'materials.package')) {
        this.archive = new Archive(path);
        this.raw = new Map();
        for (const [name, entry] of this.archive.files) {
            const key = basename(name).slice(0, -'.material'.length);
            if (!this.raw.has(key)) this.raw.set(key, entry);
        }
        this.parsed = new Map();
    }

    get(name) {
        if (this.parsed.has(name)) return this.parsed.get(name);
        const entry = this.raw.get(name);
        let material = null;
        if (entry) {
            material = {};
            const text = this.archive.readAt(entry.offset, entry.size).toString('utf8');
            for (const rawLine of text.split(/\r?\n/)) {
                const line = rawLine.trim();
                if (!line || line.startsWith('#')) continue;
                const space = line.indexOf(' ');
                const key = space < 0 ? line : line.slice(0, space);
                const value = parseMaterialValue(space < 0 ? '' : line.slice(space + 1));
                if (key === 'flag') (material.flags ??= []).push(value);
                else material[key] = value;
            }
        }
        this.parsed.set(name, material);
        return material;
    }

    // The material with its `parent` chain merged in (the child's values win)
    resolve(name, depth = 0) {
        const material = this.get(name);
        if (!material || depth > 8 || !material.parent) return material;
        const parent = this.resolve(material.parent, depth + 1);
        if (parent) return { ...parent, ...material };
        return material;
    }
}

// <level>.all_paint_data as Map<entity pid, Uint32Array of per-vertex paint (R, G, B, A bytes)>
export function readPaint(level) {
    const path = paths.game('data-common', level + '.all_paint_data');
    if (!existsSync(path)) return new Map();
    const file = readFileSync(path);
    const magic = file.toString('latin1', 0, 4);
    const version = file.readUInt32LE(4);
    const entityCount = file.readUInt32LE(8);
    const arrayCount = file.readUInt32LE(12);
    if (magic !== 'allp' || version !== 6) throw new Error(`unsupported paint data ${magic} v${version}`);
    let at = 16;
    const arrays = [];
    for (let i = 0; i < arrayCount; i++) {
        const count = file.readUInt32LE(at + 4);
        at += 8;
        arrays.push(copyOf(file, at, count, Uint32Array));
        at += 4 * count;
    }
    if (at + entityCount * 8 !== file.length) throw new Error('paint data size mismatch');
    const paint = new Map();
    for (let i = 0; i < entityCount; i++)
        paint.set(file.readUInt32LE(at + 8 * i), arrays[file.readUInt32LE(at + 8 * i + 4)]);
    return paint;
}
