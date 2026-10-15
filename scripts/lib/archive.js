// The game's package archives (data/*.package): a header, the files back to back, and a table of contents at the end
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { Reader } from '../../src/reader.ts';

const HEADER_SIZE = 0x18;
const TOC_OFFSET_AT = 0x10;
const TOC_ENTRIES_START = 0x40;

export class Archive {
    constructor(path) {
        this.fd = openSync(path, 'r');
        this.files = new Map();
        this.readTableOfContents();
    }

    close() {
        closeSync(this.fd);
    }

    readAt(offset, size) {
        const buffer = Buffer.alloc(size);
        let done = 0;
        while (done < size) {
            const count = readSync(this.fd, buffer, done, size - done, offset + done);
            if (count === 0) throw new Error(`archive ends at ${offset + done}, wanted ${size} bytes at ${offset}`);
            done += count;
        }
        return buffer;
    }

    readTableOfContents() {
        const head = this.readAt(0, HEADER_SIZE);
        if (head.toString('latin1', 0, 4) !== 'simp') throw new Error('not a simp package');
        const tocOffset = Number(head.readBigUInt64LE(TOC_OFFSET_AT));
        const fileSize = fstatSync(this.fd).size;
        const toc = new Reader(this.readAt(tocOffset, fileSize - tocOffset));
        if (toc.str(4) !== 'toc!') throw new Error('no toc');
        toc.skip(4);
        const count = toc.n64();
        toc.skip(TOC_ENTRIES_START - 16);
        for (let i = 0; i < count; i++) {
            const nameLength = toc.u32();
            const name = toc.str(nameLength);
            toc.skip(1);
            const size = toc.n64();
            const offset = toc.n64();
            this.files.set(name, { offset, size });
        }
    }

    // The bytes of a file in the archive
    read(name) {
        const { offset, size } = this.files.get(name);
        return this.readAt(offset, size);
    }
}
