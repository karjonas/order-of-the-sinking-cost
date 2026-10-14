// Little-endian byte writer for building synthetic save files in the tests
export class Writer {
    constructor() {
        this.parts = [];
    }
    put(size, write) {
        const view = new DataView(new ArrayBuffer(size));
        write(view);
        this.parts.push(new Uint8Array(view.buffer));
        return this;
    }
    u8(value) {
        return this.put(1, (view) => view.setUint8(0, value));
    }
    u16(value) {
        return this.put(2, (view) => view.setUint16(0, value, true));
    }
    u32(value) {
        return this.put(4, (view) => view.setUint32(0, value, true));
    }
    s32(value) {
        return this.put(4, (view) => view.setInt32(0, value, true));
    }
    s64(value) {
        return this.put(8, (view) => view.setBigInt64(0, BigInt(value), true));
    }
    zeros(count) {
        this.parts.push(new Uint8Array(count));
        return this;
    }
    fill(count, value) {
        this.parts.push(new Uint8Array(count).fill(value));
        return this;
    }
    bytes(values) {
        this.parts.push(Uint8Array.from(values));
        return this;
    }
    str16(text) {
        const encoded = new TextEncoder().encode(text);
        return this.u16(encoded.length).bytes(encoded);
    }
    str64(text) {
        const encoded = new TextEncoder().encode(text);
        return this.s64(encoded.length).bytes(encoded);
    }
    get length() {
        return this.parts.reduce((total, part) => total + part.length, 0);
    }
    done() {
        const out = new Uint8Array(this.length);
        let offset = 0;
        for (const part of this.parts) {
            out.set(part, offset);
            offset += part.length;
        }
        return out;
    }
}
