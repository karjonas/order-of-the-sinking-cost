// The map's PNG writer: the chunks' CRCs and the image data read back with zlib
import { crc32, inflateSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { pngUrl } from '../src/map/png.ts';

// the chunks of a PNG file: type, data and whether the stored CRC matches
function chunksOf(png) {
    const chunks = [];
    let at = 8;
    while (at < png.length) {
        const length = png.readUInt32BE(at);
        const type = png.toString('latin1', at + 4, at + 8);
        const data = png.subarray(at + 8, at + 8 + length);
        const crcOk = png.readUInt32BE(at + 8 + length) === crc32(png.subarray(at + 4, at + 8 + length));
        chunks.push({ type, data, crcOk });
        at += 12 + length;
    }
    return chunks;
}

test('an image over one stored block reads back pixel for pixel', () => {
    const width = 200;
    const height = 100;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7) % 251;

    const url = pngUrl(width, height, pixels);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);

    const png = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const chunks = chunksOf(png);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(chunks.every((chunk) => chunk.crcOk)).toBe(true);

    const header = chunks[0].data;
    expect(header.readUInt32BE(0)).toBe(width);
    expect(header.readUInt32BE(4)).toBe(height);
    expect([...header.subarray(8)]).toEqual([8, 6, 0, 0, 0]);

    const rows = inflateSync(chunks[1].data);
    const rowBytes = width * 4;
    expect(rows.length).toBe(height * (rowBytes + 1));
    for (let row = 0; row < height; row++) {
        const start = row * (rowBytes + 1);
        expect(rows[start]).toBe(0);
        const expected = Buffer.from(pixels.subarray(row * rowBytes, (row + 1) * rowBytes));
        expect(rows.subarray(start + 1, start + 1 + rowBytes).equals(expected)).toBe(true);
    }
});
