// A PNG data URL written straight from RGBA bytes. Reading pixels back from a canvas is what browsers' fingerprinting
// protection falsifies, so the map's images never go through one. The image data is stored uncompressed: the map's
// images are small, and the browser decodes them to the same bitmap either way.

const CRC_TABLE = new Uint32Array(256);
for (let byte = 0; byte < 256; byte++) {
    let crc = byte;
    for (let bit = 0; bit < 8; bit++) {
        if (crc & 1) {
            crc = 0xedb88320 ^ (crc >>> 1);
        } else {
            crc = crc >>> 1;
        }
    }
    CRC_TABLE[byte] = crc;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
    let crc = 0xffffffff;
    for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
    let low = 1;
    let high = 0;
    for (let i = 0; i < bytes.length; i++) {
        low = (low + bytes[i]) % 65521;
        high = (high + low) % 65521;
    }
    return ((high << 16) | low) >>> 0;
}

// the zlib stream of the bytes in stored (uncompressed) deflate blocks
function zlibStored(bytes: Uint8Array): Uint8Array {
    const blockSize = 65535;
    const blockCount = Math.max(1, Math.ceil(bytes.length / blockSize));
    const out = new Uint8Array(2 + blockCount * 5 + bytes.length + 4);
    const view = new DataView(out.buffer);
    out[0] = 0x78;
    out[1] = 0x01;

    let at = 2;
    for (let block = 0; block < blockCount; block++) {
        const start = block * blockSize;
        const length = Math.min(blockSize, bytes.length - start);
        const isLast = block === blockCount - 1;
        out[at] = isLast ? 1 : 0;
        view.setUint16(at + 1, length, true);
        view.setUint16(at + 3, ~length & 0xffff, true);
        out.set(bytes.subarray(start, start + length), at + 5);
        at += 5 + length;
    }

    view.setUint32(at, adler32(bytes));
    return out;
}

// one PNG chunk: length, type, data and the CRC of type and data
function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
}

function toBase64(bytes: Uint8Array): string {
    const pieces: string[] = [];
    const pieceSize = 0x8000;
    for (let start = 0; start < bytes.length; start += pieceSize) {
        pieces.push(String.fromCharCode(...bytes.subarray(start, start + pieceSize)));
    }
    return btoa(pieces.join(''));
}

/** A data URL of an 8-bit RGBA PNG of the given size from its pixels, row by row. */
export function pngUrl(width: number, height: number, pixels: Uint8ClampedArray): string {
    const header = new Uint8Array(13);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, width);
    headerView.setUint32(4, height);
    header[8] = 8;
    header[9] = 6;

    // every row starts with its filter type, 0 (none)
    const rowBytes = width * 4;
    const rows = new Uint8Array(height * (rowBytes + 1));
    for (let row = 0; row < height; row++) {
        rows.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes), row * (rowBytes + 1) + 1);
    }

    const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const parts = [signature, chunk('IHDR', header), chunk('IDAT', zlibStored(rows)), chunk('IEND', new Uint8Array(0))];
    let total = 0;
    for (const part of parts) total += part.length;

    const png = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
        png.set(part, at);
        at += part.length;
    }

    return 'data:image/png;base64,' + toBase64(png);
}
