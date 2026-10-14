// Little-endian binary reader over a byte buffer, shared by the save readers and the data scripts
const UTF8 = new TextDecoder();
export class Reader {
    constructor(buf, off = 0, end) {
        this.u8a = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        this.dv = new DataView(this.u8a.buffer, this.u8a.byteOffset, this.u8a.byteLength);
        this.p = off;
        this.end = end ?? this.u8a.byteLength;
    }
    need(n) {
        if (n < 0 || this.p + n > this.end) throw new Error(`read of ${n} bytes at ${this.p} past end ${this.end}`);
    }
    u8() {
        this.need(1);
        return this.dv.getUint8(this.p++);
    }
    s8() {
        this.need(1);
        return this.dv.getInt8(this.p++);
    }
    u16() {
        this.need(2);
        const v = this.dv.getUint16(this.p, true);
        this.p += 2;
        return v;
    }
    u32() {
        this.need(4);
        const v = this.dv.getUint32(this.p, true);
        this.p += 4;
        return v;
    }
    s32() {
        this.need(4);
        const v = this.dv.getInt32(this.p, true);
        this.p += 4;
        return v;
    }
    f32() {
        this.need(4);
        const v = this.dv.getFloat32(this.p, true);
        this.p += 4;
        return v;
    }
    s64() {
        this.need(8);
        const v = this.dv.getBigInt64(this.p, true);
        this.p += 8;
        return v;
    }
    n64() {
        const v = this.s64();
        if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER))
            throw new Error(`count ${v} too large at ${this.p - 8}`);
        return Number(v);
    }
    skip(n) {
        this.need(n);
        this.p += n;
    }
    bytes(n) {
        this.need(n);
        const v = this.u8a.subarray(this.p, this.p + n);
        this.p += n;
        return v;
    }
    str(n) {
        return UTF8.decode(this.bytes(n));
    }
    str16() {
        return this.str(this.u16());
    }
    str64() {
        return this.str(this.n64());
    }
    get left() {
        return this.end - this.p;
    }
}
